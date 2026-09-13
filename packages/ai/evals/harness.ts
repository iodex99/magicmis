/**
 * Eval harness (SPEC §14). Runs a prompt version for a stage and tier over a labelled dataset,
 * scores it, records `ai_eval_runs` and returns a report.
 *
 * Modes:
 *  - `live`: real Anthropic calls through the production orchestrator (cost and ai_calls rows are
 *    recorded like any call). Responses are saved so the run can be replayed. Only live runs can
 *    activate a prompt version.
 *  - `replay`: responses come from a recording. With no recording, an oracle recording built from
 *    the labels is used — that proves the harness end to end in CI and never counts for activation.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type Anthropic from "@anthropic-ai/sdk";
import type { Pool } from "pg";

import { recordEvalRun } from "../src/activation";
import { CostBudget, runStage, type StageSpec } from "../src/orchestrator";
import type { Stage, Tier } from "../src/registry";
import {
  classifySheetsSpec,
  extractReferenceLayoutSpec,
  generateCommentarySpec,
  mapColumnsSpec,
  type ExtractReferenceLayoutInput,
  type ExtractReferenceLayoutOutput,
  type GenerateCommentaryInput,
  type GenerateCommentaryOutput,
} from "../src/stages";
import {
  chatEditStageSpec,
  chatQuickSpec,
  summariseThreadSpec,
  type ChatAnswerOutput,
  type ChatEditInput,
  type ChatEditOutput,
  type ChatQuickInput,
  type SummariseThreadInput,
  type SummariseThreadOutput,
} from "../src/chat-stages";
import type { AiTransport, CreateParams } from "../src/transport";
import {
  chatEditDataset,
  chatQuickDataset,
  columnMappingDataset,
  commentaryDataset,
  threadSummaryDataset,
  type EditLabel,
  type ScopeLabel,
  referenceLayoutDataset,
  sheetClassificationDataset,
  type EvalItem,
  type ReferenceLabel,
} from "./datasets";

export type Recording = Record<
  string,
  { text: string; usage: Anthropic.Usage; model: string }
>;

export interface EvalReport {
  readonly stage: Stage;
  readonly tier: Tier;
  readonly promptVersion: number;
  readonly mode: "replay" | "live";
  readonly oracle: boolean;
  readonly items: number;
  readonly correct: number;
  readonly accuracy: string;
  readonly costMicroUsd: bigint;
  readonly p50LatencyMs: number | null;
  readonly failures: readonly { id: string; reason: string }[];
  readonly evalRunId: string;
}

interface StageEval<I, O, L> {
  readonly spec: StageSpec<I, O>;
  readonly dataset: (limit: number) => EvalItem<I, L>[];
  /** Units scored per item and how many were right. */
  readonly score: (output: O, label: L) => { units: number; correct: number };
  /** The perfect answer, for oracle replays. */
  readonly oracle: (item: EvalItem<I, L>) => O;
}

const sheetEval: StageEval<
  Parameters<typeof classifySheetsSpec.volatile>[0],
  {
    sheets: {
      ref: string;
      report_type: string;
      confidence: "high" | "medium" | "low";
      reason: string;
    }[];
  },
  string
> = {
  spec: classifySheetsSpec as never,
  dataset: sheetClassificationDataset,
  score: (o, label) => ({
    units: 1,
    correct: o.sheets[0]?.report_type === label ? 1 : 0,
  }),
  oracle: (item) => ({
    sheets: [
      { ref: "s1", report_type: item.label, confidence: "high", reason: "oracle" },
    ],
  }),
};

const columnEval: StageEval<
  Parameters<typeof mapColumnsSpec.volatile>[0],
  {
    columns: {
      ref: string;
      role: string | null;
      confidence: "high" | "medium" | "low";
    }[];
  },
  Record<string, string | null>
> = {
  spec: mapColumnsSpec as never,
  dataset: columnMappingDataset,
  score: (o, label) => {
    const got = new Map(o.columns.map((c) => [c.ref, c.role]));
    const refs = Object.keys(label);
    return {
      units: refs.length,
      correct: refs.filter((r) => (got.get(r) ?? null) === label[r]).length,
    };
  },
  oracle: (item) => ({
    columns: Object.entries(item.label).map(([ref, role]) => ({
      ref,
      role,
      confidence: "high" as const,
    })),
  }),
};

const referenceEval: StageEval<
  ExtractReferenceLayoutInput,
  ExtractReferenceLayoutOutput,
  ReferenceLabel
> = {
  spec: extractReferenceLayoutSpec,
  dataset: referenceLayoutDataset,
  // Per unbound row: the kind, and for a metric the metric, must match.
  score: (o, label) => {
    const got = new Map(o.rows.map((r) => [r.ref, r.kind === "metric" ? r.metric : r.kind]));
    const refs = Object.keys(label);
    return {
      units: refs.length,
      correct: refs.filter((r) => got.get(r) === label[r]).length,
    };
  },
  oracle: (item) => {
    const rows = item.input.sheets.flatMap((s) => s.rows);
    return {
      rows: Object.entries(item.label).map(([ref, shows]) => {
        const formula = rows.find((r) => r.ref === ref)?.formula ?? "";
        return {
          ref,
          kind:
            shows === "unavailable"
              ? ("unavailable" as const)
              : shows === "subtotal"
                ? ("subtotal" as const)
                : ("metric" as const),
          metric: shows === "unavailable" || shows === "subtotal" ? null : shows,
          terms:
            shows === "subtotal"
              ? [...formula.matchAll(/([+-]?)(s\d+r\d+)/gu)].map((m) => ({
                  row: m[2] ?? "",
                  sign: m[1] === "-" ? (-1 as const) : (1 as const),
                }))
              : null,
          confidence: "high" as const,
        };
      }),
    };
  },
};

const commentaryEval: StageEval<GenerateCommentaryInput, GenerateCommentaryOutput, null> =
  {
    spec: generateCommentarySpec,
    dataset: commentaryDataset,
    // Output reaching the score already passed V12 (a failure never returns); one unit per section.
    score: (o, _label) => ({ units: 1, correct: o.sections.length > 0 ? 1 : 0 }),
    oracle: (item) => ({
      sections: item.input.sections.map((heading) => ({
        heading,
        paragraphs: [
          {
            text:
              item.input.factsPack.facts[0] === undefined
                ? "The data for this month is insufficient to comment."
                : `${item.input.factsPack.facts[0].label} was {{${item.input.factsPack.facts[0].id}}}.`,
          },
        ],
      })),
    }),
  };

const chatQuickEval: StageEval<ChatQuickInput, ChatAnswerOutput, ScopeLabel> = {
  spec: chatQuickSpec,
  dataset: chatQuickDataset,
  // Output that reaches scoring passed the placeholder check; the scope must match.
  score: (o, label) => ({ units: 1, correct: o.scope === label ? 1 : 0 }),
  oracle: (item) =>
    item.label === "out_of_scope"
      ? { scope: "out_of_scope", paragraphs: [{ text: "I can only answer questions about this MIS." }] }
      : {
          scope: "in_scope",
          paragraphs: [
            {
              text:
                item.input.facts[0] === undefined
                  ? "The stored MIS does not cover that question."
                  : `The figure is {{${item.input.facts[0].id}}}.`,
            },
          ],
        },
};

const chatEditEval: StageEval<ChatEditInput, ChatEditOutput, EditLabel> = {
  spec: chatEditStageSpec,
  dataset: chatEditDataset,
  // The proposal passed patch validation; it must change what was asked for.
  score: (o, label) => ({
    units: 1,
    correct: o.operations.some((op) => op.path === label.path || op.path.startsWith(`${label.path}/`)) ? 1 : 0,
  }),
  oracle: (item) => ({
    scope: "in_scope",
    summary: "Makes the requested change.",
    operations: [
      item.label.path.endsWith("/title")
        ? { op: "replace", path: item.label.path, from: null, value_json: JSON.stringify("Sales") }
        : item.label.path.endsWith("/periods")
          ? { op: "replace", path: item.label.path, from: null, value_json: JSON.stringify({ kind: "last_n", n: 6 }) }
          : { op: "remove", path: item.label.path, from: null, value_json: null },
    ],
  }),
};

const threadSummaryEval: StageEval<SummariseThreadInput, SummariseThreadOutput, null> = {
  spec: summariseThreadSpec,
  dataset: threadSummaryDataset,
  score: (o) => ({ units: 1, correct: o.summary.length > 0 ? 1 : 0 }),
  oracle: () => ({ summary: "The user asked about revenue, which was {{m:revenue@2026-05}}, and about receivables." }),
};

export const STAGE_EVALS = {
  chat_quick: chatQuickEval,
  chat_edit: chatEditEval,
  thread_summary: threadSummaryEval,
  sheet_classification: sheetEval,
  column_mapping: columnEval,
  reference_layout: referenceEval,
  commentary: commentaryEval,
} as const;
export type EvaluableStage = keyof typeof STAGE_EVALS;

const dataKey = (params: CreateParams): string => {
  const first = params.messages[0]?.content;
  const text = Array.isArray(first)
    ? first.map((b) => (b.type === "text" ? b.text : "")).join("\n")
    : String(first);
  return createHash("sha256").update(`${params.model}\n${text}`).digest("hex");
};

/** Replays recorded responses keyed by model and user content. */
export function replayTransport(recording: Recording): AiTransport {
  return {
    create(params) {
      const hit = recording[dataKey(params)];
      if (hit === undefined)
        return Promise.reject(new Error("no recording for this request"));
      return Promise.resolve({
        message: {
          id: `msg_replay_${randomUUID()}`,
          type: "message",
          role: "assistant",
          model: hit.model,
          content: [{ type: "text", text: hit.text, citations: null }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: hit.usage,
        } as unknown as Anthropic.Message,
        requestId: null,
      });
    },
    countTokens: () => Promise.resolve(0),
    createBatch: () => Promise.reject(new Error("replay has no batches")),
    retrieveBatch: () => Promise.reject(new Error("replay has no batches")),
    batchResults: () => Promise.reject(new Error("replay has no batches")),
  };
}

/** Wraps a live transport and captures responses into a recording. */
export function recordingTransport(inner: AiTransport, into: Recording): AiTransport {
  return {
    ...inner,
    async create(params) {
      const result = await inner.create(params);
      if (params.messages.length === 1) {
        into[dataKey(params)] = {
          text: result.message.content
            .map((b) => (b.type === "text" ? b.text : ""))
            .join(""),
          usage: result.message.usage,
          model: result.message.model,
        };
      }
      return result;
    },
    countTokens: (p) => inner.countTokens(p),
  };
}

const ZERO_USAGE = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation: null,
  inference_geo: null,
  output_tokens_details: null,
  server_tool_use: null,
  service_tier: "standard",
} as unknown as Anthropic.Usage;

async function evalAccount(pool: Pool): Promise<string> {
  const email = "eval-harness@example.test";
  const found = await pool.query<{ id: string }>(
    `select id from accounts where email = $1`,
    [email],
  );
  if (found.rows[0] !== undefined) return found.rows[0].id;
  const r = await pool.query<{ id: string }>(
    `insert into accounts (auth_user_id, email, business_name, state_code)
     values (gen_random_uuid(), $1, 'Eval Harness (synthetic)', '27') returning id`,
    [email],
  );
  const id = r.rows[0]?.id;
  if (id === undefined) throw new Error("eval account insert failed");
  return id;
}

export async function runEval(input: {
  pool: Pool;
  stage: EvaluableStage;
  tier: Tier;
  promptVersion: number;
  mode: "replay" | "live";
  limit?: number;
  /** Required for live mode. */
  liveTransport?: AiTransport;
  recordingPath?: string;
}): Promise<EvalReport> {
  const def = STAGE_EVALS[input.stage] as unknown as StageEval<unknown, unknown, unknown>;
  const items = def.dataset(input.limit ?? 60);
  const accountId = await evalAccount(input.pool);
  const route = await input.pool.query<{ model_id: string }>(
    `select model_id from tier_routing where tier = $1 and stage = $2 order by version desc limit 1`,
    [input.tier, input.stage],
  );
  const modelId = route.rows[0]?.model_id ?? "unknown";

  let recording: Recording = {};
  let oracle = false;
  let current: EvalItem<unknown, unknown> | null = null;
  let transport: AiTransport;
  if (input.mode === "live") {
    if (input.liveTransport === undefined) throw new Error("live evals need a transport");
    transport = recordingTransport(input.liveTransport, recording);
  } else {
    if (input.recordingPath !== undefined) {
      recording = JSON.parse(
        await readFile(input.recordingPath, "utf8").catch(() => "{}"),
      ) as Recording;
    }
    if (Object.keys(recording).length === 0) {
      oracle = true;
      // Items run one at a time, so the oracle answers for the item in flight.
      transport = {
        ...replayTransport({}),
        create(params) {
          const out = current === null ? {} : def.oracle(current);
          return Promise.resolve({
            message: {
              id: `msg_oracle_${randomUUID()}`,
              type: "message",
              role: "assistant",
              model: params.model,
              content: [{ type: "text", text: JSON.stringify(out), citations: null }],
              stop_reason: "end_turn",
              stop_sequence: null,
              usage: ZERO_USAGE,
            } as unknown as Anthropic.Message,
            requestId: null,
          });
        },
      };
    } else {
      transport = replayTransport(recording);
    }
  }

  let units = 0;
  let correct = 0;
  let cost = 0n;
  const latencies: number[] = [];
  const failures: { id: string; reason: string }[] = [];

  for (const item of items) {
    current = item;
    const started = Date.now();
    try {
      const result = await runStage(
        {
          db: input.pool,
          transport,
          accountId,
          jobId: null,
          tier: input.tier,
          // Evals are platform spend, bounded per item rather than by a customer price.
          budget: new CostBudget(100_000n),
        },
        def.spec,
        item.input,
        input.promptVersion,
      );
      latencies.push(Date.now() - started);
      cost += result.costMicroUsd;
      const s = def.score(result.output, item.label);
      units += s.units;
      correct += s.correct;
      if (s.correct < s.units) failures.push({ id: item.id, reason: "mismatch" });
    } catch (error) {
      units += def.score(def.oracle(item), item.label).units;
      failures.push({
        id: item.id,
        reason: error instanceof Error ? error.message : "error",
      });
    }
  }

  if (input.mode === "live" && input.recordingPath !== undefined) {
    await mkdir(path.dirname(input.recordingPath), { recursive: true });
    await writeFile(input.recordingPath, JSON.stringify(recording, null, 2));
  }

  latencies.sort((a, b) => a - b);
  const p50 =
    latencies.length === 0 ? null : (latencies[Math.floor(latencies.length / 2)] ?? null);
  const safeUnits = Math.max(units, 1);
  const evalRunId = await recordEvalRun(input.pool, {
    stage: input.stage,
    promptName: def.spec.promptName,
    promptVersion: input.promptVersion,
    tier: input.tier,
    modelId,
    mode: input.mode,
    items: safeUnits,
    correct,
    costMicroUsd: cost,
    p50LatencyMs: p50,
    report: { oracle, dataset_items: items.length, failures: failures.slice(0, 50) },
  });
  const bp = (BigInt(correct) * 10_000n) / BigInt(safeUnits);
  const s = bp.toString().padStart(5, "0");
  return {
    stage: input.stage,
    tier: input.tier,
    promptVersion: input.promptVersion,
    mode: input.mode,
    oracle,
    items: safeUnits,
    correct,
    accuracy: `${s.slice(0, -4)}.${s.slice(-4)}`,
    costMicroUsd: cost,
    p50LatencyMs: p50,
    failures,
    evalRunId,
  };
}
