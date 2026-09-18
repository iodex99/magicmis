/**
 * SPEC §34 Phase 8 acceptance, server side, against real Postgres with a scripted Anthropic
 * transport: the round cap is enforced by the server; an out-of-scope decline is charged at the
 * type's price; placeholders resolve with lineage (metric values and query cells with SQL and
 * tables); guard rejections cost a round; results are validated; threads cap and continue from a
 * summary; failures release.
 */

import { randomUUID } from "node:crypto";

import type { PeriodId } from "@magicmis/core/time";
import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import { latestBlueprint, storeBlueprint, storeSnapshot } from "@magicmis/engine/server";
import {
  applyDashboardPatch,
  companyDashboard,
  completeDashboardAddon,
  confirmJob,
  createJob,
  undoDashboard,
} from "@magicmis/jobs";
import { MONTHLY_FINANCIAL_MIS } from "@magicmis/templates";
import { priceFor } from "@magicmis/wallet";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { message, ScriptedTransport } from "../../ai/test/helpers";
import {
  accountWithCompany,
  emptySnapshot,
  wallet,
  wrapper,
} from "../../jobs/test/helpers";
import {
  ChatError,
  processMessage,
  sendMessage,
  submitStepResult,
  threadView,
  type MessageType,
} from "../src/server";

let db: TestDb | undefined;
beforeAll(async () => {
  db = await startTestDb();
  await db.pool.query(`update tier_routing set prompt_version = 1`);
}, 180_000);
afterAll(async () => {
  await db?.stop();
});
const pool = () => {
  if (db === undefined) throw new Error("db not started");
  return db.pool;
};

const PERIOD = "2026-05" as PeriodId;

async function setConfig(key: string, value: unknown) {
  await pool().query(
    `insert into app_config (key, value, version, effective_from)
     values ($1, $2, (select coalesce(max(version), 0) + 1 from app_config where key = $1), now() - interval '1 minute')`,
    [key, JSON.stringify(value)],
  );
}

async function company(credits = 5_000n) {
  const c = await accountWithCompany(pool(), credits);
  const snap = emptySnapshot(PERIOD);
  const value = (metricId: string, v: string, unit: "paise" | "percent" = "paise") => ({
    metricId,
    period: PERIOD,
    dims: {},
    value: v,
    nullReason: null,
    unit,
    formula: `${metricId} formula`,
    inputs: [],
  });
  await storeSnapshot(pool(), wrapper, {
    ...c,
    jobId: null,
    payload: {
      ...snap,
      metricStore: {
        ...snap.metricStore,
        values: [
          value("revenue", "7455550000"),
          value("revenue.mom_abs", "-120000000"),
          value("revenue.mom_pct", "-1.583333", "percent"),
        ],
      },
    },
  });
  await storeBlueprint(pool(), wrapper, {
    ...c,
    jobId: null,
    parts: {
      templateSpec: MONTHLY_FINANCIAL_MIS,
      recipe: {},
      mappingRules: [],
      dashboardSpec: null,
      materiality: {},
      sourceFingerprints: {},
    },
    basedOn: null,
  });
  await pool().query(`update companies set first_setup_at = now() where id = $1`, [
    c.companyId,
  ]);
  return c;
}

type ScriptedMessage = ReturnType<typeof message>;

const toolMessage = (
  name: string,
  input: unknown,
  model = "claude-sonnet-5",
): ScriptedMessage => {
  const base = message("", { model, stop_reason: "tool_use" });
  return {
    ...base,
    content: [
      { type: "tool_use", id: `toolu_${randomUUID().replace(/-/gu, "")}`, name, input },
    ],
  } as unknown as ScriptedMessage;
};

const send = (
  c: { accountId: string; companyId: string },
  type: MessageType,
  text: string,
  threadId: string | null = null,
) =>
  sendMessage(pool(), wrapper, {
    ...c,
    threadId,
    type,
    tier: "professional",
    text,
    idempotencyKey: randomUUID(),
  });

const price = async (actionKey: "chat_quick" | "chat_deep" | "chat_edit") =>
  (await priceFor(pool(), { actionKey, tier: "professional", delivery: "instant" }))
    .credits;

const GOOD_QUICK = JSON.stringify({
  scope: "in_scope",
  paragraphs: [
    {
      text: "Revenue was {{m:revenue@2026-05}}, a change of {{mv:revenue.mom@2026-05:pct}} on the previous month.",
    },
  ],
});

describe("Quick", () => {
  it("holds the price, answers from retrieved facts, captures, and resolves placeholders with values", async () => {
    const c = await company();
    const sent = await send(c, "quick", "How did sales move this month?");
    expect(sent.priceCredits).toBe(await price("chat_quick"));
    expect(await wallet(pool(), c.accountId)).toEqual({
      balance: 5_000n,
      held: sent.priceCredits,
    });

    const t = new ScriptedTransport([{ kind: "message", message: message(GOOD_QUICK) }]);
    const r = await processMessage(pool(), wrapper, t, {
      accountId: c.accountId,
      messageId: sent.messageId,
    });
    expect(r).toEqual({
      status: "completed",
      state: "completed",
      capturedCredits: sent.priceCredits,
    });
    expect(await wallet(pool(), c.accountId)).toEqual({
      balance: 5_000n - sent.priceCredits,
      held: 0n,
    });

    const request = JSON.stringify(t.created[0]?.messages);
    expect(request).toContain("m:revenue@2026-05");
    expect(request).toContain("<data>");
    expect(request).toContain("How did sales move this month?");
    expect(t.created[0]?.output_config?.format?.type).toBe("json_schema");

    const view = await threadView(pool(), wrapper, {
      accountId: c.accountId,
      threadId: sent.threadId,
    });
    const reply = view?.messages.find((m) => m.role === "assistant");
    expect(reply?.reply).toMatchObject({ kind: "answer" });
    expect(reply?.values.map((v) => `${v.metricId}@${v.period}`).sort()).toEqual([
      "revenue.mom_pct@2026-05",
      "revenue@2026-05",
    ]);
    expect(reply?.values[0]?.formula).toContain("formula");
  });

  it("an out-of-scope request is declined in one sentence and still charged at the type's price", async () => {
    const c = await company();
    const sent = await send(c, "quick", "Write me a poem about the sea.");
    const t = new ScriptedTransport([
      {
        kind: "message",
        message: message(
          JSON.stringify({
            scope: "out_of_scope",
            paragraphs: [{ text: "I can only answer questions about this MIS." }],
          }),
        ),
      },
    ]);
    const r = await processMessage(pool(), wrapper, t, {
      accountId: c.accountId,
      messageId: sent.messageId,
    });
    expect(r).toEqual({
      status: "completed",
      state: "declined_out_of_scope",
      capturedCredits: await price("chat_quick"),
    });
    expect((await wallet(pool(), c.accountId)).balance).toBe(
      5_000n - (await price("chat_quick")),
    );
  });

  it("an answer with figures fails after one repair and releases the hold", async () => {
    const c = await company();
    const sent = await send(c, "quick", "Revenue?");
    const bad = JSON.stringify({
      scope: "in_scope",
      paragraphs: [{ text: "Revenue was ₹74.5 crore." }],
    });
    const t = new ScriptedTransport([
      { kind: "message", message: message(bad) },
      { kind: "message", message: message(bad) },
    ]);
    const r = await processMessage(pool(), wrapper, t, {
      accountId: c.accountId,
      messageId: sent.messageId,
    });
    expect(r.status).toBe("failed");
    expect(await wallet(pool(), c.accountId)).toEqual({ balance: 5_000n, held: 0n });
  });

  it("refuses without enough credits and keeps no message", async () => {
    const c = await company(1n);
    await expect(send(c, "quick", "Revenue?")).rejects.toMatchObject({
      code: "insufficient_credits",
    });
    const n = await pool().query(
      `select count(*)::int as n from chat_messages where account_id = $1`,
      [c.accountId],
    );
    expect(n.rows[0]).toEqual({ n: 0 });
  });
});

describe("Deep", () => {
  const Q1 =
    "SELECT head, sum(closing_paise) AS total FROM balances WHERE period = '2026-05' GROUP BY head";

  it("queries through the browser, rejects unsafe SQL as a spent round, and answers with query-cell lineage", async () => {
    const c = await company();
    const sent = await send(c, "deep", "Which head has the largest closing balance?");
    const t = new ScriptedTransport([
      {
        kind: "message",
        message: toolMessage("run_query", { sql: Q1, purpose: "closing by head" }),
      },
    ]);
    const first = await processMessage(pool(), wrapper, t, {
      accountId: c.accountId,
      messageId: sent.messageId,
    });
    if (first.status !== "needs_query") throw new Error(first.status);
    expect(first).toMatchObject({ stepRef: "q1", sql: Q1 });
    expect(t.created[0]?.tool_choice).toEqual({
      type: "any",
      disable_parallel_tool_use: true,
    });
    expect(t.created[0]?.tools?.map((tool) => ("name" in tool ? tool.name : ""))).toEqual(
      ["run_query", "answer"],
    );

    t.push(
      {
        kind: "message",
        message: toolMessage("run_query", {
          sql: "SELECT * FROM read_csv('x.csv')",
          purpose: "sneaky",
        }),
      },
      {
        kind: "message",
        message: toolMessage("answer", {
          scope: "in_scope",
          paragraphs: [
            {
              text: "The largest closing balance is {{q:q1:0:head}} at {{q:q1:0:total}}.",
            },
          ],
        }),
      },
    );
    const done = await submitStepResult(pool(), wrapper, t, {
      accountId: c.accountId,
      messageId: sent.messageId,
      stepId: first.stepId,
      result: {
        status: "ok",
        columns: ["head", "total"],
        rows: [["CA_RECEIVABLES", "900000000"]],
        truncated: false,
      },
    });
    expect(done).toEqual({
      status: "completed",
      state: "completed",
      capturedCredits: await price("chat_deep"),
    });
    // The rejected query went back to the model as an error tool result.
    expect(JSON.stringify(t.created[2]?.messages)).toContain(
      "table functions (such as read_csv or glob) are not allowed",
    );

    const steps = await pool().query<{
      step_ref: string;
      status: string;
      row_count: number | null;
    }>(
      `select step_ref, status, row_count from chat_query_steps where chat_message_id = $1 order by round`,
      [sent.messageId],
    );
    expect(steps.rows).toEqual([
      { step_ref: "q1", status: "ok", row_count: 1 },
      { step_ref: "q2", status: "rejected", row_count: null },
    ]);
    const view = await threadView(pool(), wrapper, {
      accountId: c.accountId,
      threadId: sent.threadId,
    });
    const reply = view?.messages.find((m) => m.role === "assistant");
    expect(reply?.queries).toEqual([
      {
        ref: "q1",
        sql: Q1,
        purpose: "closing by head",
        tables: ["balances"],
        result: {
          status: "ok",
          columns: ["head", "total"],
          rows: [["CA_RECEIVABLES", "900000000"]],
          truncated: false,
        },
      },
    ]);
    const calls = await pool().query(
      `select count(*)::int as n from ai_calls where chat_message_id = $1`,
      [sent.messageId],
    );
    expect(calls.rows[0]).toEqual({ n: 3 });
  });

  it("enforces the round cap on the server: at the cap the model must answer", async () => {
    await setConfig("chat.max_rounds", 2);
    try {
      const c = await company();
      const sent = await send(c, "investigate", "Why did revenue fall?");
      const q = (n: number) => ({
        kind: "message" as const,
        message: toolMessage("run_query", {
          sql: `SELECT period FROM balances LIMIT ${n.toString()}`,
          purpose: "p",
        }),
      });
      const t = new ScriptedTransport([q(1)]);
      let p = await processMessage(pool(), wrapper, t, {
        accountId: c.accountId,
        messageId: sent.messageId,
      });
      const result = {
        status: "ok",
        columns: ["period"],
        rows: [["2026-05"]],
        truncated: false,
      };
      for (let i = 0; i < 2; i += 1) {
        if (p.status !== "needs_query") throw new Error(p.status);
        t.push(
          i === 0
            ? q(2)
            : {
                kind: "message",
                message: toolMessage("answer", {
                  scope: "in_scope",
                  paragraphs: [{ text: "The loaded ledgers cover {{q:q1:0:period}}." }],
                }),
              },
        );
        p = await submitStepResult(pool(), wrapper, t, {
          accountId: c.accountId,
          messageId: sent.messageId,
          stepId: p.stepId,
          result,
        });
      }
      expect(p.status).toBe("completed");
      expect(t.created[2]?.tool_choice).toEqual({
        type: "tool",
        name: "answer",
        disable_parallel_tool_use: true,
      });
      const rounds = await pool().query(
        `select rounds_used from chat_messages where id = $1`,
        [sent.messageId],
      );
      expect(rounds.rows[0]).toEqual({ rounds_used: 2 });

      // A model that still calls run_query at the cap is refused, repaired once, then failed and released.
      const c2 = await company();
      const sent2 = await send(c2, "deep", "Why?");
      const t2 = new ScriptedTransport([q(1)]);
      let p2 = await processMessage(pool(), wrapper, t2, {
        accountId: c2.accountId,
        messageId: sent2.messageId,
      });
      if (p2.status !== "needs_query") throw new Error(p2.status);
      t2.push(q(2));
      p2 = await submitStepResult(pool(), wrapper, t2, {
        accountId: c2.accountId,
        messageId: sent2.messageId,
        stepId: p2.stepId,
        result,
      });
      if (p2.status !== "needs_query") throw new Error(p2.status);
      t2.push(q(3), q(4));
      p2 = await submitStepResult(pool(), wrapper, t2, {
        accountId: c2.accountId,
        messageId: sent2.messageId,
        stepId: p2.stepId,
        result,
      });
      expect(p2.status).toBe("failed");
      expect(await wallet(pool(), c2.accountId)).toEqual({ balance: 5_000n, held: 0n });
      const steps = await pool().query(
        `select count(*)::int as n from chat_query_steps where chat_message_id = $1`,
        [sent2.messageId],
      );
      expect(steps.rows[0]).toEqual({ n: 2 });
    } finally {
      await setConfig("chat.max_rounds", 5);
    }
  });

  it("validates results: size, shape and redaction; the step stays pending", async () => {
    const c = await company();
    const sent = await send(c, "deep", "List customers");
    const t = new ScriptedTransport([
      {
        kind: "message",
        message: toolMessage("run_query", {
          sql: "SELECT ledger FROM balances",
          purpose: "ledgers",
        }),
      },
    ]);
    const p = await processMessage(pool(), wrapper, t, {
      accountId: c.accountId,
      messageId: sent.messageId,
    });
    if (p.status !== "needs_query") throw new Error(p.status);
    const submit = (result: unknown) =>
      submitStepResult(pool(), wrapper, t, {
        accountId: c.accountId,
        messageId: sent.messageId,
        stepId: p.stepId,
        result,
      });
    await expect(
      submit({
        status: "ok",
        columns: ["ledger"],
        rows: Array.from({ length: 51 }, () => ["PARTY_1a2b3c4d5e6f"]),
        truncated: true,
      }),
    ).rejects.toMatchObject({ code: "result_invalid" });
    await expect(
      submit({
        status: "ok",
        columns: ["ledger"],
        rows: [["ABCDE1234F"]],
        truncated: false,
      }),
    ).rejects.toMatchObject({
      code: "result_invalid",
    });
    await expect(
      submit({ status: "ok", columns: ["a", "b"], rows: [["x"]], truncated: false }),
    ).rejects.toBeInstanceOf(ChatError);
    const step = await pool().query(`select status from chat_query_steps where id = $1`, [
      p.stepId,
    ]);
    expect(step.rows[0]).toEqual({ status: "pending" });
  });
});

describe("Edit", () => {
  it("applies a validated dashboard change as it is proposed, and it can be undone", async () => {
    const c = await company();
    const job = await createJob(pool(), {
      ...c,
      type: "dashboard_addon",
      tier: "professional",
      delivery: "standard",
      idempotencyKey: randomUUID(),
      size: {
        files: 0,
        sheets: 0,
        columns: 0,
        rows: 0,
        distinctLedgerValues: 0,
        referenceMisSheets: 0,
      },
    });
    await confirmJob(pool(), { accountId: c.accountId, jobId: job.jobId });
    await completeDashboardAddon(pool(), wrapper, {
      accountId: c.accountId,
      jobId: job.jobId,
    });

    const sent = await sendMessage(pool(), wrapper, {
      ...c,
      threadId: null,
      type: "edit",
      tier: "professional",
      text: "Call the first card Sales",
      editTarget: "dashboard",
      idempotencyKey: randomUUID(),
    });
    const edit = (value: string) =>
      JSON.stringify({
        scope: "in_scope",
        summary: "Renames the first card.",
        operations: [
          { op: "replace", path: "/widgets/0/title", from: null, value_json: value },
        ],
      });
    // The first proposal is invalid JSON for the value and is repaired.
    const t = new ScriptedTransport([
      { kind: "message", message: message(edit("Sales")) },
      { kind: "message", message: message(edit(JSON.stringify("Sales"))) },
    ]);
    const r = await processMessage(pool(), wrapper, t, {
      accountId: c.accountId,
      messageId: sent.messageId,
    });
    expect(r).toMatchObject({ status: "completed", state: "completed" });
    const view = await threadView(pool(), wrapper, {
      accountId: c.accountId,
      threadId: sent.threadId,
    });
    const reply = view?.messages.find((m) => m.role === "assistant")?.reply;
    if (reply?.kind !== "edit") throw new Error("no edit");
    expect(reply.operations).toEqual([
      { op: "replace", path: "/widgets/0/title", value: "Sales" },
    ]);
    // ADR 0046: the customer chats and the dashboard follows. Nothing waits for an Apply.
    expect(reply.appliedVersion).toBe(reply.baseVersion + 1);
    const after = await companyDashboard(pool(), wrapper, c);
    expect(after).toMatchObject({
      blueprintVersion: reply.appliedVersion,
      canUndo: true,
    });
    expect(after?.spec.widgets[0]?.title).toBe("Sales");
    // Applying it again by hand is refused rather than doubled: the base has moved on.
    await expect(
      applyDashboardPatch(pool(), wrapper, {
        ...c,
        baseVersion: reply.baseVersion,
        operations: reply.operations,
      }),
    ).rejects.toMatchObject({ code: "stale" });
    const undone = await undoDashboard(pool(), wrapper, {
      ...c,
      baseVersion: reply.appliedVersion ?? 0,
    });
    expect(undone.spec.widgets[0]?.title).toBe("Revenue");
  });

  it("a change to the MIS template is proposed and waits for the customer", async () => {
    const c = await company();
    const sent = await sendMessage(pool(), wrapper, {
      ...c,
      threadId: null,
      type: "edit",
      tier: "professional",
      text: "Call the first row Sales",
      editTarget: "template",
      idempotencyKey: randomUUID(),
    });
    const t = new ScriptedTransport([
      {
        kind: "message",
        message: message(
          JSON.stringify({
            scope: "in_scope",
            summary: "Renames the first row.",
            operations: [
              {
                op: "replace",
                path: "/sections/0/rows/0/label",
                from: null,
                value_json: JSON.stringify("Sales"),
              },
            ],
          }),
        ),
      },
    ]);
    await processMessage(pool(), wrapper, t, {
      accountId: c.accountId,
      messageId: sent.messageId,
    });
    const view = await threadView(pool(), wrapper, {
      accountId: c.accountId,
      threadId: sent.threadId,
    });
    const reply = view?.messages.find((m) => m.role === "assistant")?.reply;
    if (reply?.kind !== "edit") throw new Error("no edit");
    expect(reply.appliedVersion).toBeNull();
    // Still version one: the next workbook is not changed by a sentence in a chat.
    expect((await latestBlueprint(pool(), wrapper, c))?.version).toBe(1);
  });
});

describe("Edit against a saved layout that cannot be read", () => {
  it("ends uncharged without calling the model, and leaves what is saved alone", async () => {
    const c = await company();
    const broken = { spec: { widgets: "not a list" }, parentVersion: null };
    await storeBlueprint(pool(), wrapper, {
      ...c,
      jobId: null,
      parts: {
        templateSpec: MONTHLY_FINANCIAL_MIS,
        recipe: {},
        mappingRules: [],
        dashboardSpec: broken,
        materiality: {},
        sourceFingerprints: {},
      },
      basedOn: 1,
    });
    const sent = await sendMessage(pool(), wrapper, {
      ...c,
      threadId: null,
      type: "edit",
      tier: "professional",
      text: "Call the first card Sales",
      editTarget: "dashboard",
      idempotencyKey: randomUUID(),
    });
    // No scripted reply: a call to the model would throw, and the test would fail on it.
    const r = await processMessage(pool(), wrapper, new ScriptedTransport([]), {
      accountId: c.accountId,
      messageId: sent.messageId,
    });
    expect(r).toEqual({ status: "failed", reason: "layout_unreadable" });
    expect(await wallet(pool(), c.accountId)).toEqual({ balance: 5_000n, held: 0n });
    const after = await latestBlueprint(pool(), wrapper, c);
    expect(after?.version).toBe(2);
    expect(after?.parts.dashboardSpec).toEqual(broken);
  });
});

describe("threads", () => {
  it("caps a thread and continues in a new one seeded with a summary charged to its first message", async () => {
    await setConfig("chat.thread_message_cap", 2);
    try {
      const c = await company();
      const t = new ScriptedTransport();
      let threadId: string | null = null;
      for (let i = 0; i < 2; i += 1) {
        const sent = await send(
          c,
          "quick",
          `Revenue question ${i === 0 ? "one" : "two"}?`,
          threadId,
        );
        threadId = sent.threadId;
        t.push({ kind: "message", message: message(GOOD_QUICK) });
        await processMessage(pool(), wrapper, t, {
          accountId: c.accountId,
          messageId: sent.messageId,
        });
      }
      const third = await send(c, "quick", "And now?", threadId);
      expect(third.threadId).not.toBe(threadId);
      const old = await pool().query(`select status from chat_threads where id = $1`, [
        threadId,
      ]);
      expect(old.rows[0]).toEqual({ status: "capped" });

      t.push(
        {
          kind: "message",
          message: message(
            JSON.stringify({
              summary: "The user asked about {{m:revenue@2026-05}} twice.",
            }),
            { model: "claude-haiku-4-5-20251001" },
          ),
        },
        { kind: "message", message: message(GOOD_QUICK) },
      );
      const r = await processMessage(pool(), wrapper, t, {
        accountId: c.accountId,
        messageId: third.messageId,
      });
      expect(r.status).toBe("completed");
      expect(JSON.stringify(t.created.at(-1)?.messages)).toContain(
        "Summary of the earlier conversation",
      );
      const stages = await pool().query<{ stage: string }>(
        `select stage from ai_calls where chat_message_id = $1 order by created_at`,
        [third.messageId],
      );
      expect(stages.rows.map((s) => s.stage)).toEqual(["thread_summary", "chat_quick"]);
    } finally {
      await setConfig("chat.thread_message_cap", 20);
    }
  });
});

describe("sweep", () => {
  it("closes messages left waiting past their hold and releases the credits", async () => {
    const { sweepChatMessages } = await import("../src/server");
    const c = await company();
    const sent = await send(c, "deep", "Which ledgers moved?");
    const t = new ScriptedTransport([
      {
        kind: "message",
        message: toolMessage("run_query", {
          sql: "SELECT ledger FROM balances",
          purpose: "ledgers",
        }),
      },
    ]);
    const p = await processMessage(pool(), wrapper, t, {
      accountId: c.accountId,
      messageId: sent.messageId,
    });
    expect(p.status).toBe("needs_query");
    expect(await sweepChatMessages(pool(), new Date())).toBe(0);
    const later = new Date(Date.now() + 3 * 3600 * 1000);
    expect(await sweepChatMessages(pool(), later)).toBeGreaterThanOrEqual(1);
    const row = await pool().query(
      `select state, failure_reason from chat_messages where id = $1`,
      [sent.messageId],
    );
    expect(row.rows[0]).toEqual({
      state: "failed_platform",
      failure_reason: "abandoned",
    });
    expect(await wallet(pool(), c.accountId)).toEqual({ balance: 5_000n, held: 0n });
  });
});
