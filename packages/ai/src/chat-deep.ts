/**
 * Deep chat (SPEC §27): a tool loop over the user's session data, one server round per call.
 *
 * The model has two strict tools: `run_query(sql, purpose)` and `answer(scope, paragraphs)`. Each
 * round the tool choice forces exactly one tool call; when the round cap (config, enforced here
 * from the server's own step count) is reached, it forces `answer`. A query is returned to the
 * caller, which guards it, has the browser run it, and calls again with the result as a stored
 * step. The conversation is rebuilt from those steps each round, so nothing but steps is kept.
 * Answers pass the placeholder check (facts and query cells) with one repair.
 *
 * API shapes verified against `@anthropic-ai/sdk` 0.125.0 typings and
 * https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview: `tools[].strict`,
 * `tool_choice` `{type: "any" | "tool", disable_parallel_tool_use}`, `tool_use` / `tool_result`
 * blocks with `tool_use_id` and `is_error`.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { microUsd } from "@magicmis/core/money";
import { readConfig } from "@magicmis/db/config";
import { checkPlaceholderTexts } from "@magicmis/engine";
import { z } from "zod";

import {
  chatAnswerOutput,
  historyTurn,
  placeholderIdsIn,
  scopeProblems,
  type ChatAnswerOutput,
} from "./chat-stages";
import { costPaise, projectedCallCostMicroUsd } from "./cost";
import { dataBlock } from "./data-tags";
import {
  AiStageError,
  promptText,
  recordCall,
  RuntimeCapExceeded,
  type AiContext,
} from "./orchestrator";
import { loadModel, loadRoute, modelSupportsEffort } from "./registry";
import { structuredOutputSchema } from "./schema";
import { errorType, isFallbackError } from "./transport";

const fxSchema = z.object({ inr_per_usd: z.string(), buffer_percent: z.string() });

const stepOutcome = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    columns: z.array(z.string().max(80)).max(40),
    rows: z.array(z.array(z.string().max(400)).max(40)).max(50),
    truncated: z.boolean(),
  }),
  z.object({ status: z.literal("rejected"), reason: z.string().max(500) }),
  z.object({ status: z.literal("error"), reason: z.string().max(500) }),
]);
export type StepOutcome = z.infer<typeof stepOutcome>;

export const chatDeepInput = z.object({
  companyName: z.string().max(200),
  tables: z
    .array(
      z.object({
        name: z.string().max(60),
        description: z.string().max(300),
        columns: z
          .array(
            z.object({
              name: z.string().max(60),
              type: z.string().max(30),
              description: z.string().max(200),
            }),
          )
          .max(40),
      }),
    )
    .max(10),
  facts: z
    .array(
      z.object({
        id: z.string().max(120),
        label: z.string().max(200),
        text: z.string().max(60),
      }),
    )
    .max(200),
  periods: z.array(z.string().max(20)).max(40),
  summary: z.string().max(6000).nullable(),
  history: z.array(historyTurn).max(40),
  question: z.string().min(1).max(2000),
  steps: z
    .array(
      z.object({
        ref: z.string().regex(/^q\d{1,2}$/u),
        toolUseId: z.string().min(1).max(100),
        sql: z.string().max(4000),
        purpose: z.string().max(300),
        outcome: stepOutcome,
      }),
    )
    .max(20),
  maxRounds: z.number().int().min(1).max(20),
  allowlist: z.array(z.string().max(40)).max(50),
});
export type ChatDeepInput = z.infer<typeof chatDeepInput>;

export type DeepStep =
  | {
      readonly kind: "query";
      readonly toolUseId: string;
      readonly sql: string;
      readonly purpose: string;
    }
  | {
      readonly kind: "answer";
      readonly output: ChatAnswerOutput;
      readonly forced: boolean;
      readonly modelUsed: string;
    };

const MAX_INPUT_BYTES = 256_000;

const table = (rows: readonly (readonly string[])[]): string =>
  rows.map((r) => r.map((c) => c.replace(/[\t\n\r]/gu, " ")).join("\t")).join("\n");

const RUN_QUERY: Anthropic.Tool = {
  name: "run_query",
  description:
    "Run one read-only SELECT over the session tables listed in the context and get up to fifty rows back. Call this when the facts provided do not answer the question and the tables can. Amounts are integer paise. The result comes back as a tool result with a step reference such as q1.",
  input_schema: {
    type: "object",
    properties: {
      sql: {
        type: "string",
        description: "A single SELECT statement over the session tables only.",
      },
      purpose: {
        type: "string",
        description: "What this query finds out, in a few words, without figures.",
      },
    },
    required: ["sql", "purpose"],
    additionalProperties: false,
  },
  strict: true,
};

function answerTool(): Anthropic.Tool {
  return {
    name: "answer",
    description:
      "Give the final answer to the user's question. Call this when you can answer, when the data cannot answer, or when told to answer now. Every figure must be a placeholder.",
    input_schema: structuredOutputSchema(chatAnswerOutput) as Anthropic.Tool.InputSchema,
    strict: true,
  };
}

function conversation(input: ChatDeepInput): Anthropic.MessageParam[] {
  const context: Anthropic.TextBlockParam[] = [
    // Every block carries user-derived text (names, earlier messages, the question): all of it is data.
    { type: "text", text: dataBlock(`Company: ${input.companyName}`) },
    {
      type: "text",
      text: dataBlock(
        `Session tables:\n${input.tables
          .map(
            (t) =>
              `${t.name}: ${t.description}\n${table(t.columns.map((c) => [c.name, c.type, c.description]))}`,
          )
          .join("\n\n")}`,
      ),
    },
    {
      type: "text",
      text: dataBlock(
        [
          input.summary === null
            ? ""
            : `Summary of the earlier conversation:\n${input.summary}`,
          input.history.length === 0
            ? "No earlier messages in this thread."
            : input.history.map((h) => `${h.role}: ${h.text}`).join("\n"),
        ]
          .filter((s) => s !== "")
          .join("\n\n"),
      ),
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: dataBlock(
        `facts:\n${table(input.facts.map((f) => [f.id, f.label, f.text]))}\nperiods: ${input.periods.join(", ")}\nquestion:\n${input.question}`,
      ),
    },
  ];
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: context }];
  for (const step of input.steps) {
    messages.push({
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: step.toolUseId,
          name: "run_query",
          input: { sql: step.sql, purpose: step.purpose },
        },
      ],
    });
    messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: step.toolUseId,
          is_error: step.outcome.status !== "ok",
          content: dataBlock(
            `step ${step.ref}\n${
              step.outcome.status === "ok"
                ? `columns: ${step.outcome.columns.join(" | ")}\n${step.outcome.rows.map((r, i) => `${i.toString()}\t${r.join("\t")}`).join("\n")}${step.outcome.truncated ? "\n(more rows were cut off)" : ""}`
                : `${step.outcome.status}: ${step.outcome.reason}`
            }`,
          ),
        },
      ],
    });
  }
  return messages;
}

export function checkDeepAnswer(
  input: ChatDeepInput,
  output: ChatAnswerOutput,
): string[] {
  const known = new Set([
    ...input.facts.map((f) => f.id),
    ...input.periods,
    ...placeholderIdsIn(input.history.map((h) => h.text)),
  ]);
  const queries = input.steps.flatMap((s) =>
    s.outcome.status === "ok"
      ? [{ stepId: s.ref, rowCount: s.outcome.rows.length, columns: s.outcome.columns }]
      : [],
  );
  return [
    ...scopeProblems(output),
    ...checkPlaceholderTexts(
      output.paragraphs.map((p, i) => ({
        where: `paragraph ${(i + 1).toString()}`,
        text: p.text,
      })),
      known,
      input.allowlist,
      queries,
    ),
  ];
}

/** One Deep round: a query to run, or the checked final answer. */
export async function chatDeepStep(ctx: AiContext, rawInput: unknown): Promise<DeepStep> {
  const input = chatDeepInput.parse(rawInput);
  const bytes = new TextEncoder().encode(JSON.stringify(input)).length;
  if (bytes > MAX_INPUT_BYTES)
    throw new AiStageError(
      "input_too_large",
      `chat_deep input is ${bytes.toString()} bytes`,
    );
  const route = await loadRoute(ctx.db, ctx.tier, "chat_deep");
  const promptVersion = route.prompt_version ?? 0;
  const fx = await readConfig(ctx.db, "ai.fx", fxSchema);
  const system: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: await promptText("chat_deep", promptVersion),
      cache_control: { type: "ephemeral" },
    },
  ];
  const tools = [RUN_QUERY, answerTool()];
  // The cap counts stored steps, which only the server writes.
  const atCap = input.steps.length >= input.maxRounds;
  let fallbackFrom: string | null = null;

  for (const modelId of [route.model_id, ...route.fallback_chain]) {
    const model = await loadModel(ctx.db, modelId);
    if (!model.available) {
      fallbackFrom ??= modelId;
      continue;
    }
    const effort =
      route.effort !== null && modelSupportsEffort(modelId) ? route.effort : null;
    let messages = conversation(input);
    if (atCap)
      messages = [
        ...messages.slice(0, -1),
        ...(messages.length > 1
          ? [
              appendText(
                messages.at(-1),
                "The query limit for this question is reached. Answer now with what you have.",
              ),
            ]
          : [appendText(messages[0], "Answer now.")]),
      ];
    let forceAnswer = atCap;
    const common = {
      ctx,
      stage: "chat_deep" as const,
      promptVersion,
      modelRequested: route.model_id,
      model,
      effort,
      maxTokens: route.max_tokens,
      fx,
    };

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const toolChoice: Anthropic.ToolChoice = forceAnswer
        ? { type: "tool", name: "answer", disable_parallel_tool_use: true }
        : { type: "any", disable_parallel_tool_use: true };
      const counted = await ctx.transport.countTokens({
        model: modelId,
        system,
        messages,
        tools,
        tool_choice: toolChoice,
      });
      const projected = microUsd(
        ctx.budget.spentMicroUsd +
          projectedCallCostMicroUsd(counted, route.max_tokens, model),
      );
      const projectedPaise = costPaise(projected, fx).paise;
      if (projectedPaise > ctx.budget.capPaise)
        throw new RuntimeCapExceeded(
          "chat_deep",
          projectedPaise,
          ctx.budget.capPaise,
          ctx.budget.spentMicroUsd,
        );

      const started = Date.now();
      let result;
      try {
        result = await ctx.transport.create({
          model: modelId,
          max_tokens: route.max_tokens,
          system,
          messages,
          tools,
          tool_choice: toolChoice,
          ...(effort === null ? {} : { output_config: { effort } }),
        });
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
          break;
        }
        throw new AiStageError("api_error", `chat_deep failed: ${errorType(error)}`);
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
        throw new AiStageError("refusal", "chat_deep was declined by the model");
      }
      if (message.stop_reason === "max_tokens") {
        await recordCall({ ...call, status: "invalid_output", errorType: "max_tokens" });
        throw new AiStageError("truncated", "chat_deep output hit max_tokens");
      }

      const toolUse = message.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      let problem: string;
      if (toolUse?.name === "run_query" && !forceAnswer) {
        const q = z
          .object({ sql: z.string().min(1).max(4000), purpose: z.string().max(300) })
          .safeParse(toolUse.input);
        if (q.success) {
          await recordCall({ ...call, status: "ok", errorType: null });
          return {
            kind: "query",
            toolUseId: toolUse.id,
            sql: q.data.sql,
            purpose: q.data.purpose,
          };
        }
        problem = "run_query needs sql and purpose";
      } else if (toolUse?.name === "answer") {
        const parsed = chatAnswerOutput.safeParse(toolUse.input);
        const problems = parsed.success
          ? checkDeepAnswer(input, parsed.data)
          : parsed.error.issues.map(
              (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
            );
        if (parsed.success && problems.length === 0) {
          await recordCall({ ...call, status: "ok", errorType: null });
          return {
            kind: "answer",
            output: parsed.data,
            forced: atCap,
            modelUsed: modelId,
          };
        }
        problem = problems.join("; ");
      } else {
        problem = forceAnswer ? "call the answer tool now" : "call run_query or answer";
      }

      await recordCall({
        ...call,
        status: "invalid_output",
        errorType: attempt === 1 ? "validation_repairable" : "validation",
      });
      if (attempt === 2)
        throw new AiStageError(
          "invalid_output",
          "chat_deep output failed validation after one repair",
        );
      // One repair: the rejected call with its problems, and the answer tool forced.
      const blocks: Anthropic.ContentBlockParam[] = message.content.flatMap(
        (b): Anthropic.ContentBlockParam[] =>
          b.type === "tool_use"
            ? [{ type: "tool_use", id: b.id, name: b.name, input: b.input }]
            : b.type === "text"
              ? [{ type: "text", text: b.text }]
              : [],
      );
      messages = [
        ...messages,
        {
          role: "assistant",
          content:
            blocks.length === 0 ? [{ type: "text", text: "(no tool call)" }] : blocks,
        },
        {
          role: "user",
          content:
            toolUse === undefined
              ? `Your previous response was not accepted: ${problem.slice(0, 2000)}. Call the answer tool.`
              : [
                  {
                    type: "tool_result",
                    tool_use_id: toolUse.id,
                    is_error: true,
                    content: `Not accepted: ${problem.slice(0, 2000)}. Call the answer tool with a corrected answer.`,
                  },
                ],
        },
      ];
      forceAnswer = true;
    }
  }
  throw new AiStageError(
    "no_model_available",
    "chat_deep: every model in the fallback chain failed or is unavailable",
  );
}

function appendText(
  message: Anthropic.MessageParam | undefined,
  note: string,
): Anthropic.MessageParam {
  if (message === undefined) return { role: "user", content: note };
  const content: Anthropic.ContentBlockParam[] =
    typeof message.content === "string"
      ? [{ type: "text", text: message.content }]
      : [...message.content];
  return { ...message, content: [...content, { type: "text", text: note }] };
}
