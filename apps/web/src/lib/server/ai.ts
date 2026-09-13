import "server-only";

import { anthropicTransport, type AiTransport } from "@magicmis/ai";
import { z } from "zod";

import { appPublicEnv, serverEnv } from "../env";

/**
 * The AI transport for server routes. Always Anthropic, except `AI_TRANSPORT=fake` in development:
 * a deterministic stand-in so browser tests can drive chat end to end without a key or network. It
 * produces only what the real stages would accept and is refused in any other environment.
 */
export function aiTransport(): AiTransport {
  const mode = z
    .enum(["anthropic", "fake"])
    .default("anthropic")
    .parse(process.env["AI_TRANSPORT"]);
  if (mode === "fake") {
    if (appPublicEnv().NEXT_PUBLIC_ENVIRONMENT !== "development")
      throw new Error("the fake AI transport is allowed only in development");
    return fakeTransport();
  }
  return anthropicTransport(serverEnv().ANTHROPIC_API_KEY);
}

type Params = Parameters<AiTransport["create"]>[0];

const textOf = (params: Params): string => JSON.stringify(params.messages);
const systemOf = (params: Params): string =>
  Array.isArray(params.system)
    ? params.system.map((b) => b.text).join("\n")
    : (params.system ?? "");

function reply(params: Params, content: unknown[]) {
  return Promise.resolve({
    message: {
      id: `msg_fake_${crypto.randomUUID()}`,
      type: "message",
      role: "assistant",
      model: params.model,
      content,
      stop_reason: content.some((c) => (c as { type: string }).type === "tool_use")
        ? "tool_use"
        : "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: 500,
        output_tokens: 80,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    } as unknown as Awaited<ReturnType<AiTransport["create"]>>["message"],
    requestId: null,
  });
}

function fakeTransport(): AiTransport {
  return {
    create(params) {
      const text = textOf(params);
      const system = systemOf(params);
      if (params.tools !== undefined) {
        const answered = text.includes('"type":"tool_result"');
        return reply(params, [
          answered
            ? {
                type: "tool_use",
                id: `toolu_${crypto.randomUUID().replace(/-/gu, "")}`,
                name: "answer",
                input: {
                  scope: "in_scope",
                  paragraphs: [
                    {
                      text: "The largest closing balance by head is {{q:q1:0:head}} at {{q:q1:0:total}}.",
                    },
                  ],
                },
              }
            : {
                type: "tool_use",
                id: `toolu_${crypto.randomUUID().replace(/-/gu, "")}`,
                name: "run_query",
                input: {
                  sql: "SELECT head, sum(closing_paise) AS total FROM balances GROUP BY head ORDER BY total DESC",
                  purpose: "closing balance by head",
                },
              },
        ]);
      }
      let out: unknown;
      if (system.startsWith("You change a company's dashboard")) {
        out = {
          scope: "in_scope",
          summary: "Renames the first card to Sales.",
          operations: [
            {
              op: "replace",
              path: "/widgets/0/title",
              from: null,
              value_json: JSON.stringify("Sales"),
            },
          ],
        };
      } else if (system.startsWith("You summarise")) {
        out = { summary: "Earlier questions were about this company's figures." };
      } else if (/poem/iu.test(text)) {
        out = {
          scope: "out_of_scope",
          paragraphs: [{ text: "I can only answer questions about this MIS." }],
        };
      } else {
        const fact = /(m:[a-z_.]+@\d{4}-\d{2})\\t/u.exec(text)?.[1];
        out = {
          scope: "in_scope",
          paragraphs: [
            {
              text:
                fact === undefined
                  ? "The stored MIS does not have figures for that question."
                  : `The figure you asked about is {{${fact}}}.`,
            },
          ],
        };
      }
      return reply(params, [{ type: "text", text: JSON.stringify(out) }]);
    },
    countTokens: () => Promise.resolve(500),
    createBatch: () => Promise.reject(new Error("the fake transport has no batches")),
    retrieveBatch: () => Promise.reject(new Error("the fake transport has no batches")),
    batchResults: () => Promise.reject(new Error("the fake transport has no batches")),
  };
}
