/**
 * The stage orchestrator (SPEC §14). Internal: not exported from the package index. Stage
 * functions give it a fixed prompt name, schemas and payload builders; the caller supplies only
 * validated input, the tier and a cost budget. Model, effort and max_tokens come from routing.
 *
 * Per call:
 *  1. route → model; effort only where the model supports it;
 *  2. runtime cap: projected = spent + counted input × input price + max_tokens × output price;
 *     over the cap → RuntimeCapExceeded, before anything is sent;
 *  3. create with structured output; record an ai_calls row whatever the outcome;
 *  4. refusal or truncation → platform fault; invalid JSON or schema → one repair, then fault;
 *  5. not-found/permission/5xx after SDK retries → next model in the fallback chain.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type Anthropic from "@anthropic-ai/sdk";
import { microUsd, type MicroUsd } from "@magicmis/core/money";
import { readConfig } from "@magicmis/db/config";
import type { Queryable } from "@magicmis/db/tx";
import type { Pool } from "pg";
import { z } from "zod";

import {
  costMicroUsd,
  costPaise,
  projectedCallCostMicroUsd,
  type FxConfig,
} from "./cost";
import {
  loadModel,
  loadRoute,
  modelSupportsEffort,
  type Effort,
  type ModelRow,
  type RouteRow,
  type Stage,
  type Tier,
} from "./registry";
import { dataBlock } from "./data-tags";
import { structuredOutputSchema } from "./schema";
import {
  errorType,
  isFallbackError,
  type AiTransport,
  type CreateParams,
} from "./transport";

const PROMPTS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "prompts",
);

export class AiStageError extends Error {
  readonly failureClass = "platform_fault" as const;
  constructor(
    readonly code:
      | "invalid_output"
      | "refusal"
      | "truncated"
      | "api_error"
      | "no_model_available"
      | "input_too_large",
    message: string,
  ) {
    super(message);
    this.name = "AiStageError";
  }
}

export class RuntimeCapExceeded extends Error {
  constructor(
    readonly stage: Stage,
    readonly projectedPaise: bigint,
    readonly capPaise: bigint,
    readonly spentMicroUsd: MicroUsd,
  ) {
    super(
      `projected AI cost ${projectedPaise.toString()} paise exceeds the cap ${capPaise.toString()} paise`,
    );
    this.name = "RuntimeCapExceeded";
  }
}

/** Running AI cost for one job or chat message against its cap (SPEC §12). */
export class CostBudget {
  private spent: bigint;
  constructor(
    readonly capPaise: bigint,
    spentMicroUsd: bigint = 0n,
  ) {
    this.spent = spentMicroUsd;
  }
  get spentMicroUsd(): MicroUsd {
    return microUsd(this.spent);
  }
  add(cost: MicroUsd): void {
    this.spent += cost;
  }
}

export interface AiContext {
  readonly db: Pool;
  readonly transport: AiTransport;
  readonly accountId: string;
  readonly jobId: string | null;
  readonly chatMessageId?: string | null;
  readonly tier: Tier;
  readonly budget: CostBudget;
}

export interface StageSpec<I, O> {
  readonly stage: Stage;
  readonly promptName: string;
  readonly input: z.ZodType<I>;
  readonly output: z.ZodType<O>;
  /** SPEC §14: per-action maximum payload size, enforced before any call. */
  readonly maxInputBytes: number;
  /** Stable context blocks, most stable first (cached). */
  readonly stable: (input: I) => readonly string[];
  /** The volatile payload, wrapped in <data> tags. */
  readonly volatile: (input: I) => string;
  /** Checks that need the input (every ref answered once, allowed codes); problems trigger the repair. */
  readonly check?: (input: I, output: O) => string[];
}

export interface StageResult<O> {
  readonly output: O;
  readonly modelRequested: string;
  readonly modelUsed: string;
  readonly downgraded: boolean;
  readonly costMicroUsd: MicroUsd;
}

export async function promptText(name: string, version: number): Promise<string> {
  const [rules, body] = await Promise.all([
    readFile(path.join(PROMPTS_DIR, "_rules", "v1.md"), "utf8"),
    readFile(path.join(PROMPTS_DIR, name, `v${version.toString()}.md`), "utf8"),
  ]);
  return `${body.trim()}\n\n${rules.trim()}`;
}

const fxSchema = z.object({ inr_per_usd: z.string(), buffer_percent: z.string() });

interface CallRecord {
  ctx: Pick<AiContext, "db" | "accountId" | "jobId" | "chatMessageId" | "budget">;
  stage: Stage;
  promptVersion: number;
  modelRequested: string;
  model: ModelRow;
  fallbackFrom: string | null;
  effort: string | null;
  maxTokens: number;
  usage: Anthropic.Usage | null;
  latencyMs: number | null;
  requestId: string | null;
  status: "ok" | "error" | "invalid_output";
  errorType: string | null;
  fx: FxConfig;
  batchId?: string;
}

export async function recordCall(r: CallRecord): Promise<MicroUsd> {
  const batch = r.batchId !== undefined;
  const cost =
    r.usage === null ? microUsd(0n) : costMicroUsd(r.usage, r.model, { batch });
  const { paise, rateUsed } = costPaise(cost, r.fx);
  await r.ctx.db.query(
    `insert into public.ai_calls
       (job_id, chat_message_id, account_id, stage, prompt_version, model_requested, model_used, fallback_from,
        effort, max_tokens, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens,
        is_batch, batch_id, usd_cost_micro, inr_cost_paise, fx_rate_used, latency_ms, anthropic_request_id, status, error_type)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
    [
      r.ctx.jobId,
      r.ctx.chatMessageId ?? null,
      r.ctx.accountId,
      r.stage,
      `${r.stage}/v${r.promptVersion.toString()}`,
      r.modelRequested,
      r.model.model_id,
      r.fallbackFrom,
      r.effort,
      r.maxTokens,
      r.usage?.input_tokens ?? 0,
      r.usage?.output_tokens ?? 0,
      r.usage?.cache_creation_input_tokens ?? 0,
      r.usage?.cache_read_input_tokens ?? 0,
      batch,
      r.batchId ?? null,
      cost.toString(),
      paise.toString(),
      paise === 0n ? null : rateUsed,
      r.latencyMs,
      r.requestId,
      r.status,
      r.errorType,
    ],
  );
  r.ctx.budget.add(cost);
  return cost;
}

export function responseText(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

export interface PreparedStage<I> {
  readonly input: I;
  readonly route: RouteRow;
  readonly promptVersion: number;
  readonly fx: FxConfig;
  readonly system: string;
  readonly schema: Record<string, unknown>;
  readonly userContent: Anthropic.TextBlockParam[];
}

/** Validates input, enforces the payload cap, resolves routing and builds the prompt content. */
export async function prepareStage<I, O>(
  db: Queryable,
  tier: Tier,
  spec: StageSpec<I, O>,
  rawInput: unknown,
  evalPromptVersion?: number,
): Promise<PreparedStage<I>> {
  const input = spec.input.parse(rawInput);
  const bytes = new TextEncoder().encode(JSON.stringify(input)).length;
  if (bytes > spec.maxInputBytes) {
    throw new AiStageError(
      "input_too_large",
      `${spec.stage} input is ${bytes.toString()} bytes; the limit is ${spec.maxInputBytes.toString()}`,
    );
  }
  const route = await loadRoute(db, tier, spec.stage, evalPromptVersion);
  const promptVersion = route.prompt_version ?? 0;
  const stable = spec.stable(input);
  return {
    input,
    route,
    promptVersion,
    fx: await readConfig(db, "ai.fx", fxSchema),
    system: await promptText(spec.promptName, promptVersion),
    schema: structuredOutputSchema(spec.output),
    // Most stable first; the cache breakpoint closes the stable prefix (SPEC §14).
    // Stable blocks carry user-derived text too (company names, chat history, specs): all of it is data.
    userContent: [
      ...stable.map((text, i): Anthropic.TextBlockParam =>
        i === stable.length - 1
          ? { type: "text", text: dataBlock(text), cache_control: { type: "ephemeral" } }
          : { type: "text", text: dataBlock(text) },
      ),
      { type: "text", text: dataBlock(spec.volatile(input)) },
    ],
  };
}

export interface RequestBase {
  readonly model: string;
  readonly max_tokens: number;
  readonly system: Anthropic.TextBlockParam[];
  readonly output_config: Anthropic.OutputConfig;
  readonly effort: Effort | null;
}

export function requestBase(
  prepared: PreparedStage<unknown>,
  modelId: string,
): RequestBase {
  const effort =
    prepared.route.effort !== null && modelSupportsEffort(modelId)
      ? prepared.route.effort
      : null;
  return {
    model: modelId,
    max_tokens: prepared.route.max_tokens,
    system: [
      { type: "text", text: prepared.system, cache_control: { type: "ephemeral" } },
    ],
    output_config: {
      format: { type: "json_schema", schema: prepared.schema },
      ...(effort === null ? {} : { effort }),
    },
    effort,
  };
}

export type Validation<O> =
  | { readonly ok: true; readonly output: O }
  | { readonly ok: false; readonly problem: string };

export function validateOutput<I, O>(
  spec: StageSpec<I, O>,
  input: I,
  text: string,
): Validation<O> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, problem: "the response was not valid JSON" };
  }
  const parsed = spec.output.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      problem: parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; "),
    };
  }
  const semantic = spec.check?.(input, parsed.data) ?? [];
  return semantic.length === 0
    ? { ok: true, output: parsed.data }
    : { ok: false, problem: semantic.join("; ") };
}

export async function runStage<I, O>(
  ctx: AiContext,
  spec: StageSpec<I, O>,
  rawInput: unknown,
  /** Evals only (packages/ai/evals); never reachable from the exported stage functions. */
  evalPromptVersion?: number,
): Promise<StageResult<O>> {
  const prepared = await prepareStage(
    ctx.db,
    ctx.tier,
    spec,
    rawInput,
    evalPromptVersion,
  );
  const { input, route, promptVersion, fx } = prepared;
  let fallbackFrom: string | null = null;

  for (const modelId of [route.model_id, ...route.fallback_chain]) {
    const model = await loadModel(ctx.db, modelId);
    if (!model.available) {
      fallbackFrom ??= modelId;
      continue;
    }
    const { effort, ...base } = requestBase(prepared, modelId);
    let messages: Anthropic.MessageParam[] = [
      { role: "user", content: prepared.userContent },
    ];
    const common = {
      ctx,
      stage: spec.stage,
      promptVersion,
      modelRequested: route.model_id,
      model,
      effort,
      maxTokens: route.max_tokens,
      fx,
    };

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      // Runtime cap: counted input at full price plus max_tokens at output price, never optimistic.
      const counted = await ctx.transport.countTokens({
        model: modelId,
        system: base.system,
        messages,
        output_config: base.output_config,
      });
      const projected = microUsd(
        ctx.budget.spentMicroUsd +
          projectedCallCostMicroUsd(counted, route.max_tokens, model),
      );
      const projectedPaise = costPaise(projected, fx).paise;
      if (projectedPaise > ctx.budget.capPaise) {
        throw new RuntimeCapExceeded(
          spec.stage,
          projectedPaise,
          ctx.budget.capPaise,
          ctx.budget.spentMicroUsd,
        );
      }

      const params: CreateParams = { ...base, messages };
      const started = Date.now();
      let result;
      try {
        result = await ctx.transport.create(params);
      } catch (error) {
        await recordCall({
          ...common,
          fallbackFrom,
          usage: null,
          latencyMs: Date.now() - started,
          requestId: null,
          status: "error",
          errorType: errorType(error),
        });
        if (isFallbackError(error)) {
          fallbackFrom ??= modelId;
          break; // next model in the chain
        }
        throw new AiStageError("api_error", `${spec.stage} failed: ${errorType(error)}`);
      }

      const { message, requestId } = result;
      const call = {
        ...common,
        fallbackFrom,
        usage: message.usage,
        latencyMs: Date.now() - started,
        requestId,
      };

      if (message.stop_reason === "refusal") {
        await recordCall({ ...call, status: "error", errorType: "refusal" });
        throw new AiStageError("refusal", `${spec.stage} was declined by the model`);
      }
      if (message.stop_reason === "max_tokens") {
        await recordCall({ ...call, status: "invalid_output", errorType: "max_tokens" });
        throw new AiStageError("truncated", `${spec.stage} output hit max_tokens`);
      }

      const text = responseText(message);
      const v = validateOutput(spec, input, text);
      if (v.ok) {
        const cost = await recordCall({ ...call, status: "ok", errorType: null });
        return {
          output: v.output,
          modelRequested: route.model_id,
          modelUsed: modelId,
          downgraded: modelId !== route.model_id,
          costMicroUsd: cost,
        };
      }

      await recordCall({
        ...call,
        status: "invalid_output",
        errorType: attempt === 1 ? "validation_repairable" : "validation",
      });
      if (attempt === 2) {
        throw new AiStageError(
          "invalid_output",
          `${spec.stage} output failed validation after one repair`,
        );
      }
      // The single repair attempt carries the validation errors (SPEC §14) and ends on a user turn.
      messages = [
        ...messages,
        { role: "assistant", content: text === "" ? "(empty response)" : text },
        {
          role: "user",
          content: `Your previous response did not satisfy the required schema: ${v.problem.slice(0, 2000)}. Respond again with a corrected JSON object only.`,
        },
      ];
    }
  }
  throw new AiStageError(
    "no_model_available",
    `${spec.stage}: every model in the fallback chain failed or is unavailable`,
  );
}
