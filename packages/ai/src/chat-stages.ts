/**
 * Chat stages with structured outputs (SPEC §27): Quick answers, Edit proposals and thread
 * summaries. Each is a named function with a fixed prompt, schemas and payload cap; the only free
 * text is the user's question or request, wrapped in <data> as user data. Deep questions run the
 * tool loop in `chat-deep.ts`.
 */

import { patchDocument } from "@magicmis/core/json-patch";
import { checkPlaceholderTexts } from "@magicmis/engine";
import { dashboardSpecSchema } from "@magicmis/render-dashboard";
import { templateSpecSchema } from "@magicmis/templates";
import { z } from "zod";

import {
  runStage,
  type AiContext,
  type StageResult,
  type StageSpec,
} from "./orchestrator";

const text = z.string().max(4000);
const fact = z.object({
  id: z.string().max(120),
  label: z.string().max(200),
  text: z.string().max(60),
});

export const historyTurn = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().max(6000),
});

const table = (rows: readonly (readonly string[])[]): string =>
  rows.map((r) => r.map((c) => c.replace(/[\t\n\r]/gu, " ")).join("\t")).join("\n");

const historyBlock = (
  summary: string | null,
  history: readonly z.infer<typeof historyTurn>[],
) =>
  [
    summary === null ? "" : `Summary of the earlier conversation:\n${summary}`,
    history.length === 0
      ? "No earlier messages in this thread."
      : history.map((h) => `${h.role}: ${h.text}`).join("\n"),
  ]
    .filter((s) => s !== "")
    .join("\n\n");

/** Placeholder bodies mentioned in earlier turns stay valid in later answers. */
export const placeholderIdsIn = (texts: readonly string[]): string[] =>
  [...texts.join("\n").matchAll(/\{\{\s*(m|mv|d|p):([^{}\s]+)\s*\}\}/gu)].map(
    (m) => `${m[1] ?? ""}:${m[2] ?? ""}`,
  );

// ---------------------------------------------------------------------------
// Quick
// ---------------------------------------------------------------------------

export const chatQuickInput = z.object({
  companyName: z.string().max(200),
  facts: z.array(fact).max(200),
  periods: z.array(z.string().max(20)).max(40),
  summary: z.string().max(6000).nullable(),
  history: z.array(historyTurn).max(40),
  question: z.string().min(1).max(2000),
  allowlist: z.array(z.string().max(40)).max(50),
});
export type ChatQuickInput = z.infer<typeof chatQuickInput>;

export const chatAnswerOutput = z.object({
  scope: z.enum(["in_scope", "out_of_scope"]),
  paragraphs: z.array(z.object({ text })).max(8),
});
export type ChatAnswerOutput = z.infer<typeof chatAnswerOutput>;

/** Out-of-scope declines are one sentence (SPEC §27). */
export function scopeProblems(o: ChatAnswerOutput): string[] {
  if (o.scope === "in_scope")
    return o.paragraphs.length === 0 ? ["an answer needs at least one paragraph"] : [];
  const sentences = o.paragraphs
    .map((p) => p.text)
    .join(" ")
    .split(/[.!?](\s|$)/u)
    .filter((s) => s.trim().length > 1);
  return o.paragraphs.length === 1 && sentences.length <= 1
    ? []
    : ["an out-of-scope decline must be one sentence"];
}

export const chatQuickSpec: StageSpec<ChatQuickInput, ChatAnswerOutput> = {
  stage: "chat_quick",
  promptName: "chat_quick",
  input: chatQuickInput,
  output: chatAnswerOutput,
  maxInputBytes: 64_000,
  stable: (input) => [
    `Company: ${input.companyName}`,
    historyBlock(input.summary, input.history),
  ],
  volatile: (input) =>
    [
      "facts:",
      table(input.facts.map((f) => [f.id, f.label, f.text])),
      `periods: ${input.periods.join(", ")}`,
      "question:",
      input.question,
    ].join("\n"),
  check: (input, output) => [
    ...scopeProblems(output),
    ...checkPlaceholderTexts(
      output.paragraphs.map((p, i) => ({
        where: `paragraph ${(i + 1).toString()}`,
        text: p.text,
      })),
      new Set([
        ...input.facts.map((f) => f.id),
        ...input.periods,
        ...placeholderIdsIn(input.history.map((h) => h.text)),
      ]),
      input.allowlist,
      [],
    ),
  ],
};

export function chatQuick(
  ctx: AiContext,
  input: ChatQuickInput,
): Promise<StageResult<ChatAnswerOutput>> {
  return runStage(ctx, chatQuickSpec, input);
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

export const chatEditInput = z.object({
  target: z.enum(["dashboard", "template"]),
  /** The current spec, as stored. */
  spec: z.json(),
  metrics: z
    .array(
      z.object({
        id: z.string().max(60),
        label: z.string().max(120),
        unit: z.string().max(20),
      }),
    )
    .max(100),
  summary: z.string().max(6000).nullable(),
  history: z.array(historyTurn).max(40),
  request: z.string().min(1).max(2000),
});
export type ChatEditInput = z.infer<typeof chatEditInput>;

export const chatEditOutput = z.object({
  scope: z.enum(["in_scope", "out_of_scope"]),
  /** What the change does, in words; no figures. */
  summary: z.string().max(600),
  operations: z
    .array(
      z.object({
        op: z.enum(["add", "remove", "replace", "move", "copy", "test"]),
        path: z.string().max(300),
        from: z.string().max(300).nullable(),
        /** The JSON value for add, replace and test, as JSON text; null otherwise. */
        value_json: z.string().max(8000).nullable(),
      }),
    )
    .max(40),
});
export type ChatEditOutput = z.infer<typeof chatEditOutput>;

/** The model's operations as RFC 6902 operations, or the problems with them. */
export function editOperations(o: ChatEditOutput): {
  ops: unknown[];
  problems: string[];
} {
  const problems: string[] = [];
  const ops = o.operations.map((op, i) => {
    const base: Record<string, unknown> = { op: op.op, path: op.path };
    if (op.op === "move" || op.op === "copy") base["from"] = op.from;
    if (op.op === "add" || op.op === "replace" || op.op === "test") {
      try {
        base["value"] = JSON.parse(op.value_json ?? "null") as unknown;
      } catch {
        problems.push(`operation ${(i + 1).toString()}: value_json is not valid JSON`);
      }
    }
    return base;
  });
  return { ops, problems };
}

export const chatEditStageSpec: StageSpec<ChatEditInput, ChatEditOutput> = {
  stage: "chat_edit",
  promptName: "chat_edit",
  input: chatEditInput,
  output: chatEditOutput,
  maxInputBytes: 96_000,
  stable: (input) => [
    `Allowed metric IDs (id, unit, label):\n${table(input.metrics.map((m) => [m.id, m.unit, m.label]))}`,
    historyBlock(input.summary, input.history),
  ],
  volatile: (input) =>
    [
      `target: ${input.target}`,
      "current spec (JSON):",
      JSON.stringify(input.spec),
      "request:",
      input.request,
    ].join("\n"),
  check: (input, output) => {
    if (output.scope === "out_of_scope")
      return output.operations.length === 0
        ? []
        : ["an out-of-scope reply must have no operations"];
    if (output.operations.length === 0)
      return ["an in-scope edit needs at least one operation"];
    const { ops, problems } = editOperations(output);
    if (problems.length > 0) return problems;
    if (/\p{Nd}/u.test(output.summary)) problems.push("summary: must not contain digits");
    const schema =
      input.target === "dashboard" ? dashboardSpecSchema : templateSpecSchema;
    const r = patchDocument(input.spec, ops, schema);
    if (!r.ok) problems.push(...r.errors.map((e) => `patch: ${e}`));
    const known = new Set(input.metrics.map((m) => m.id));
    for (const m of JSON.stringify(ops).matchAll(/"metric"\s*:\s*"([^"]+)"/gu))
      if (!known.has(m[1] ?? "")) problems.push(`metric ${m[1] ?? ""} is not allowed`);
    return problems;
  },
};

export function chatEditSpec(
  ctx: AiContext,
  input: ChatEditInput,
): Promise<StageResult<ChatEditOutput>> {
  return runStage(ctx, chatEditStageSpec, input);
}

// ---------------------------------------------------------------------------
// Thread summary
// ---------------------------------------------------------------------------

export const summariseThreadInput = z.object({
  previousSummary: z.string().max(6000).nullable(),
  history: z.array(historyTurn).min(1).max(60),
});
export type SummariseThreadInput = z.infer<typeof summariseThreadInput>;

export const summariseThreadOutput = z.object({ summary: z.string().max(3000) });
export type SummariseThreadOutput = z.infer<typeof summariseThreadOutput>;

export const summariseThreadSpec: StageSpec<SummariseThreadInput, SummariseThreadOutput> =
  {
    stage: "thread_summary",
    promptName: "thread_summary",
    input: summariseThreadInput,
    output: summariseThreadOutput,
    maxInputBytes: 128_000,
    stable: () => ["Summarise the conversation for the next thread."],
    volatile: (input) => historyBlock(input.previousSummary, input.history),
    check: (input, output) =>
      checkPlaceholderTexts(
        [{ where: "summary", text: output.summary }],
        new Set(
          placeholderIdsIn([
            input.previousSummary ?? "",
            ...input.history.map((h) => h.text),
          ]),
        ),
        [],
        [],
      ),
  };

export function summariseThread(
  ctx: AiContext,
  input: SummariseThreadInput,
): Promise<StageResult<SummariseThreadOutput>> {
  return runStage(ctx, summariseThreadSpec, input);
}
