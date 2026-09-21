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

/**
 * The same messages as plain text, with real newlines.
 *
 * `textOf` is JSON, so every newline in it is the two characters backslash and n, and every
 * quote is escaped. Searching that for a word still works, which is why it was fine for years;
 * reading a *line* out of it does not.
 */
const promptOf = (params: Params): string =>
  params.messages
    .flatMap((m) =>
      typeof m.content === "string"
        ? [m.content]
        : m.content.map((b) => ("text" in b && typeof b.text === "string" ? b.text : "")),
    )
    .join("\n");
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

/**
 * What the stand-in proposes for a change to the dashboard (ADR 0046), by the words of the
 * request: a comparison box, a formula shown in a card, or the rename it always did. Every one is
 * what the real stage's check accepts: allowed metrics, structural constants, no digits in words.
 */
function fakeDashboardChange(prompt: string) {
  const asked = (prompt.split("request:").pop() ?? "").toLowerCase();
  const suffix = crypto
    .randomUUID()
    .replace(/[^a-f]/gu, "")
    .slice(0, 6)
    .padEnd(6, "a");
  const add = (path: string, value: unknown) => ({
    op: "add",
    path,
    from: null,
    value_json: JSON.stringify(value),
  });
  const box = (over: Record<string, unknown>) => ({
    dimension: null,
    periods: { kind: "current" },
    drilldown: { kind: "lineage" },
    compare: "none",
    ...over,
  });
  if (asked.includes("compar") || asked.includes("versus") || asked.includes("against")) {
    const lastYear = asked.includes("year");
    return {
      scope: "in_scope",
      summary: lastYear
        ? "Adds a box comparing revenue, gross profit and profit after tax with the same month last year."
        : "Adds a box comparing revenue, gross profit and profit after tax with the previous month.",
      operations: [
        add(
          "/widgets/-",
          box({
            id: `cmp_${suffix}`,
            kind: "comparison",
            title: lastYear
              ? "This month against last year"
              : "This month against last month",
            metrics: ["revenue", "gross_profit", "pat"],
            layout: { x: 0, y: 50, w: 6, h: 4 },
            compare: lastYear ? "last_year" : "previous_month",
          }),
        ),
      ],
    };
  }
  if (asked.includes("share") || asked.includes("formula") || asked.includes("ratio")) {
    const id = `calc_staff_share_${suffix}`;
    return {
      scope: "in_scope",
      summary:
        "Adds staff cost as a share of revenue, worked out from the books each month.",
      operations: [
        add("/calculated/-", {
          id,
          label: "Staff cost share of revenue",
          unit: "percent",
          expr: {
            op: "mul",
            args: [
              { op: "div", args: [{ metric: "employee_cost" }, { metric: "revenue" }] },
              { const: "100" },
            ],
          },
        }),
        add(
          "/widgets/-",
          box({
            id: `kpi_staff_share_${suffix}`,
            kind: "kpi_card",
            title: "Staff cost share of revenue",
            metrics: [id, `${id}.mom_abs`],
            layout: { x: 0, y: 60, w: 3, h: 2 },
          }),
        ),
      ],
    };
  }
  /*
   * Taking a box off and putting a different one in its place, which is one message and one
   * patch. The index cannot be hardcoded: the board it is asked about is whatever the customer
   * has already made of it, so the box is found by name in the spec the prompt carries, exactly
   * as the real model must find it.
   */
  if (/\b(remove|delete|drop|get rid of|take off)\b/u.test(asked)) {
    // The spec is one compact line of its own (chat-stages.ts). Matching a brace pair here
    // would stop at the first nested closing brace and never parse.
    const spec = /current spec \(JSON\):\n(.+)/u.exec(prompt)?.[1];
    const widgets = (() => {
      try {
        return (JSON.parse(spec ?? "{}") as { widgets?: { id: string; title: string }[] })
          .widgets;
      } catch {
        return undefined;
      }
    })();
    const named = /\b(ebitda|revenue|cash|margin|profit)\b/u.exec(asked)?.[1] ?? "";
    const at = (widgets ?? []).findIndex(
      (w) => w.id.toLowerCase().includes(named) || w.title.toLowerCase().includes(named),
    );
    if (at >= 0)
      return {
        scope: "in_scope",
        summary: `Takes the ${widgets?.[at]?.title ?? "box"} box off and puts a revenue trend in its place.`,
        operations: [
          {
            op: "remove",
            path: `/widgets/${at.toString()}`,
            from: null,
            value_json: null,
          },
          add(
            "/widgets/-",
            box({
              id: `trend_${suffix}`,
              kind: "line",
              title: "Revenue trend",
              metrics: ["revenue"],
              layout: { x: 0, y: 70, w: 6, h: 4 },
              periods: { kind: "last_n", n: 12 },
            }),
          ),
        ],
      };
  }
  return {
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
        out = fakeDashboardChange(promptOf(params));
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
