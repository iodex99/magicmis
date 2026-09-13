/**
 * Estimator and calibration, activation gate, batch client and margin report against real
 * Postgres (SPEC §12, §14, §26).
 */

import { randomUUID } from "node:crypto";

import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { activatePromptVersion, recordEvalRun } from "../src/activation";
import { collectStageBatch, submitStageBatch } from "../src/batch";
import { costMicroUsd } from "../src/cost";
import { estimateJob, priceDecision, recalibrateEstimator } from "../src/estimator";
import { marginReport, modelRegistryView } from "../src/margin";
import { CostBudget, RuntimeCapExceeded, type AiContext } from "../src/orchestrator";
import { loadModel, loadRoute } from "../src/registry";
import { classifySheetsSpec } from "../src/stages";
import { activateAllRoutes, message, newAccount, ScriptedTransport } from "./helpers";

let db: TestDb | undefined;
beforeAll(async () => {
  db = await startTestDb();
}, 180_000);
afterAll(async () => {
  await db?.stop();
});
const pool = () => {
  if (db === undefined) throw new Error("test database was not started");
  return db.pool;
};

const size = {
  files: 2,
  sheets: 4,
  columns: 40,
  rows: 5000,
  distinctLedgerValues: 300,
  referenceMisSheets: 0,
};

describe("activation gate", () => {
  it("refuses without a live eval, below threshold, and activates at or above it", async () => {
    const base = {
      stage: "sheet_classification" as const,
      promptName: "sheet_classification",
      promptVersion: 1,
      tier: "efficient" as const,
      modelId: "claude-haiku-4-5-20251001",
      costMicroUsd: 1234n,
      p50LatencyMs: 900,
      report: {},
    };
    const activate = () =>
      activatePromptVersion(pool(), {
        stage: "sheet_classification",
        tier: "efficient",
        promptVersion: 1,
        actorAdminId: null,
      });

    await expect(activate()).rejects.toMatchObject({ code: "no_eval" });
    // A replay does not count.
    await recordEvalRun(pool(), { ...base, mode: "replay", items: 100, correct: 100 });
    await expect(activate()).rejects.toMatchObject({ code: "no_eval" });
    await recordEvalRun(pool(), { ...base, mode: "live", items: 100, correct: 94 });
    await expect(activate()).rejects.toMatchObject({ code: "below_threshold" });
    await recordEvalRun(pool(), { ...base, mode: "live", items: 100, correct: 95 });
    const { routingVersion } = await activate();

    const route = await loadRoute(pool(), "efficient", "sheet_classification");
    expect(route.prompt_version).toBe(1);
    expect(route.version).toBe(routingVersion);
    const audit = await pool().query(
      `select 1 from audit_log where action = 'ai.prompt_activated'`,
    );
    expect(audit.rowCount).toBe(1);
  });
});

describe("estimator", () => {
  it("estimates per stage at the routed model and decides exact price vs quote", async () => {
    const est = await estimateJob(pool(), {
      actionKey: "company_setup",
      tier: "efficient",
      size,
    });
    expect(est.stages.map((s) => s.stage)).toEqual([
      "sheet_classification",
      "column_mapping",
      "ledger_mapping",
    ]);
    expect(est.p90MicroUsd >= est.p50MicroUsd).toBe(true);
    expect(est.calibrated).toBe(false);
    expect(priceDecision(est, est.p90Paise)).toBe("exact");
    expect(priceDecision(est, est.p90Paise - 1n)).toBe("quote");

    // Refresh on unchanged structure: zero AI stages, zero cost.
    const refresh = await estimateJob(pool(), {
      actionKey: "monthly_refresh",
      tier: "efficient",
      size,
    });
    expect(refresh.stages).toHaveLength(0);
    expect(refresh.p90MicroUsd).toBe(0n);
  });

  it("calibration raises p90 from actual ai_calls", async () => {
    const account = await newAccount(pool());
    for (let i = 0; i < 10; i += 1) {
      const job = await pool().query<{ id: string }>(
        `insert into jobs (account_id, type, tier, state, idempotency_key, completed_at, stage_checkpoints)
         values ($1, 'data_diagnostic', 'efficient', 'completed', $2, now(), '{"size_bucket":"m"}') returning id`,
        [account, randomUUID()],
      );
      await pool().query(
        `insert into ai_calls (job_id, account_id, stage, prompt_version, model_requested, model_used, max_tokens, usd_cost_micro)
         values ($1, $2, 'sheet_classification', 'sheet_classification/v1', 'm', 'm', 100, $3)`,
        [job.rows[0]?.id, account, (1_000_000 * (i + 1)).toString()],
      );
    }
    expect(await recalibrateEstimator(pool(), new Date(Date.now() - 86_400_000))).toBe(1);
    const est = await estimateJob(pool(), {
      actionKey: "data_diagnostic",
      tier: "efficient",
      size: { ...size, sheets: 40, distinctLedgerValues: 300 },
    });
    expect(est.bucket).toBe("m");
    expect(est.calibrated).toBe(true);
    expect(est.p90MicroUsd >= 9_000_000n).toBe(true);
  });
});

describe("batch client", () => {
  beforeAll(async () => {
    await activateAllRoutes(pool());
  });

  const input = (ref: string) => ({
    sheets: [
      {
        ref,
        name: "Sheet",
        titleLines: [],
        headers: ["Particulars", "Closing Balance"],
        types: ["text", "amount"],
        samples: [],
      },
    ],
  });
  const ok = (ref: string) =>
    JSON.stringify({
      sheets: [
        {
          ref,
          report_type: "group_summary",
          confidence: "medium",
          reason: "closing balances",
        },
      ],
    });

  it("submits, collects, records batch-discounted costs and returns failures for realtime retry", async () => {
    const account = await newAccount(pool());
    const t = new ScriptedTransport();
    const mk = (): AiContext => ({
      db: pool(),
      transport: t,
      accountId: account,
      jobId: null,
      tier: "efficient",
      budget: new CostBudget(1_000_000n),
    });
    const items = [
      { customId: "job-a_s1", ctx: mk(), input: input("s1") },
      { customId: "job-b_s1", ctx: mk(), input: input("s1") },
      { customId: "job-c_s1", ctx: mk(), input: input("s1") },
    ];
    const submitted = await submitStageBatch(classifySheetsSpec, items);
    expect(submitted.batchId).toBe("msgbatch_test");
    expect(t.batches[0]?.map((r) => r.custom_id)).toEqual([
      "job-a_s1",
      "job-b_s1",
      "job-c_s1",
    ]);
    expect(t.batches[0]?.[0]?.params.model).toBe("claude-haiku-4-5-20251001");

    t.batchStatus = "in_progress";
    expect(
      await collectStageBatch(classifySheetsSpec, submitted.batchId, items),
    ).toBeNull();

    const usage = { input_tokens: 2000, output_tokens: 400 };
    t.batchStatus = "ended";
    t.batchOutput = [
      { customId: "job-a_s1", type: "succeeded", message: message(ok("s1"), { usage }) },
      { customId: "job-b_s1", type: "succeeded", message: message("oops", { usage }) },
      { customId: "job-c_s1", type: "expired" },
    ];
    const results = await collectStageBatch(classifySheetsSpec, submitted.batchId, items);
    expect(results?.map((r) => r.status)).toEqual([
      "ok",
      "retry_realtime",
      "retry_realtime",
    ]);

    const model = await loadModel(pool(), "claude-haiku-4-5-20251001");
    const expected = costMicroUsd(usage, model, { batch: true });
    const rows = await pool().query<{
      is_batch: boolean;
      batch_id: string;
      usd_cost_micro: string;
      status: string;
    }>(
      `select is_batch, batch_id, usd_cost_micro, status from ai_calls where account_id = $1 order by status`,
      [account],
    );
    expect(rows.rows).toEqual([
      {
        is_batch: true,
        batch_id: "msgbatch_test",
        usd_cost_micro: expected.toString(),
        status: "invalid_output",
      },
      {
        is_batch: true,
        batch_id: "msgbatch_test",
        usd_cost_micro: expected.toString(),
        status: "ok",
      },
    ]);
  });

  it("applies the runtime cap per budget before submitting", async () => {
    const account = await newAccount(pool());
    const t = new ScriptedTransport();
    t.countResult = 50_000;
    const budget = new CostBudget(1000n); // ₹10
    const mk = (): AiContext => ({
      db: pool(),
      transport: t,
      accountId: account,
      jobId: null,
      tier: "efficient",
      budget,
    });
    // Each item projects 50k × $1 + 4k × $5 = $0.07 ≈ ₹6.85; two on one budget exceed ₹10.
    await expect(
      submitStageBatch(classifySheetsSpec, [
        { customId: "a", ctx: mk(), input: input("s1") },
        { customId: "b", ctx: mk(), input: input("s1") },
      ]),
    ).rejects.toBeInstanceOf(RuntimeCapExceeded);
    expect(t.batches).toHaveLength(0);
  });
});

describe("margin report", () => {
  it("computes AI cost ratio per action and flags over max_ai_cost_ratio", async () => {
    const account = await newAccount(pool());
    const from = new Date(Date.now() - 3_600_000);
    // company_setup: 1000 credits captured, ₹150 AI cost → 0.15 (under 0.20).
    await pool().query(
      `insert into jobs (account_id, type, state, idempotency_key, captured_credits, actual_ai_cost_paise)
       values ($1, 'company_setup', 'completed', $2, 1000, 15000)`,
      [account, randomUUID()],
    );
    // commentary: 100 credits captured, ₹30 AI cost → 0.30 (over).
    await pool().query(
      `insert into jobs (account_id, type, state, idempotency_key, captured_credits, actual_ai_cost_paise)
       values ($1, 'commentary', 'completed', $2, 100, 3000)`,
      [account, randomUUID()],
    );
    await pool().query(
      `insert into ai_calls (account_id, stage, prompt_version, model_requested, model_used, fallback_from, max_tokens,
                             input_tokens, cache_read_input_tokens, cache_creation_input_tokens, usd_cost_micro)
       values ($1, 'commentary', 'commentary/v1', 'claude-opus-5', 'claude-sonnet-5', 'claude-opus-5', 100, 1000, 3000, 0, 10),
              ($1, 'commentary', 'commentary/v1', 'claude-opus-5', 'claude-opus-5', null, 100, 1000, 0, 0, 10)`,
      [account],
    );
    const report = await marginReport(pool(), from, new Date(Date.now() + 60_000));
    const setup = report.actions.find((a) => a.actionKey === "company_setup");
    const commentary = report.actions.find((a) => a.actionKey === "commentary");
    expect(setup).toMatchObject({ ratio: "0.1500", overCap: false });
    expect(commentary).toMatchObject({ ratio: "0.3000", overCap: true });
    const stage = report.stages.find((s) => s.stage === "commentary");
    expect(stage).toMatchObject({
      calls: 2,
      cacheHitRate: "0.6000",
      fallbackRate: "0.5000",
    });
  });

  it("covers chat actions, percentiles, filters, rates and the gross margin estimate (Phase 9 acceptance)", async () => {
    const account = await newAccount(pool());
    const other = await newAccount(pool());
    const from = new Date(Date.now() - 3_600_000);
    const to = new Date(Date.now() + 60_000);
    const thread = await pool().query<{ id: string }>(
      `insert into companies (account_id, name) values ($1, 'Margin Co') returning id`,
      [account],
    );
    const t = await pool().query<{ id: string }>(
      `insert into chat_threads (account_id, company_id) values ($1, $2) returning id`,
      [account, thread.rows[0]?.id],
    );
    // Seeded over-ratio chat action: 19 credits captured (₹19), ₹5.70 AI cost → 0.30 > 0.20.
    for (const aiPaise of [570, 190]) {
      const m = await pool().query<{ id: string }>(
        `insert into chat_messages (thread_id, account_id, role, message_type, content, tier, price_credits, credits_charged, state)
         values ($1, $2, 'user', 'quick', '\\x', 'professional', 19, 19, 'completed') returning id`,
        [t.rows[0]?.id, account],
      );
      await pool().query(
        `insert into ai_calls (account_id, chat_message_id, stage, prompt_version, model_requested, model_used, max_tokens, input_tokens, usd_cost_micro, inr_cost_paise, fx_rate_used)
         values ($1, $2, 'chat_quick', 'chat_quick/v1', 'claude-sonnet-5', 'claude-sonnet-5', 1500, 1000, 50000, $3, 97.85)`,
        [account, m.rows[0]?.id, aiPaise],
      );
    }
    await pool().query(
      `insert into jobs (account_id, type, state, tier, idempotency_key, captured_credits, actual_ai_cost_paise,
                         estimated_ai_cost_micro_usd, actual_ai_cost_micro_usd, failure_class)
       values ($1, 'monthly_refresh', 'completed', 'expert', $2, 299, 1000, 100000, 150000, null),
              ($1, 'monthly_refresh', 'failed_data', 'expert', $3, 299, 0, 0, 0, 'data_fault'),
              ($4, 'monthly_refresh', 'completed', 'expert', $5, 299, 9999, 0, 0, null)`,
      [account, randomUUID(), randomUUID(), other, randomUUID()],
    );

    const report = await marginReport(pool(), from, to, { accountId: account });
    const quick = report.actions.find((a) => a.actionKey === "chat_quick");
    expect(quick).toMatchObject({
      jobs: 2,
      capturedCredits: 38n,
      aiCostPaise: 760n,
      ratio: "0.2000",
      overCap: false,
    });
    expect(quick?.p50).toBe("0.1000");
    expect(quick?.p90).toBe("0.3000");

    const flagged = await marginReport(pool(), from, to, {
      accountId: account,
      actionKey: "chat_quick",
      tier: "professional",
    });
    expect(flagged.actions).toHaveLength(1);
    // Adding a second over-ratio message pushes the action over its cap.
    const m3 = await pool().query<{ id: string }>(
      `insert into chat_messages (thread_id, account_id, role, message_type, content, tier, price_credits, credits_charged, state)
       values ($1, $2, 'user', 'quick', '\\x', 'professional', 19, 19, 'completed') returning id`,
      [t.rows[0]?.id, account],
    );
    await pool().query(
      `insert into ai_calls (account_id, chat_message_id, stage, prompt_version, model_requested, model_used, max_tokens, input_tokens, usd_cost_micro, inr_cost_paise, fx_rate_used)
       values ($1, $2, 'chat_quick', 'chat_quick/v1', 'claude-sonnet-5', 'claude-sonnet-5', 1500, 1000, 50000, 1900, 97.85)`,
      [account, m3.rows[0]?.id],
    );
    const over = await marginReport(pool(), from, to, {
      accountId: account,
      actionKey: "chat_quick",
    });
    expect(over.actions[0]).toMatchObject({ actionKey: "chat_quick", overCap: true });

    const refresh = report.actions.find((a) => a.actionKey === "monthly_refresh");
    expect(refresh).toMatchObject({ jobs: 2, capturedCredits: 598n, aiCostPaise: 1000n });
    expect(report.estimator).toEqual({
      jobs: 1,
      actualToEstimate: "1.5000",
      underestimated: 1,
    });
    expect(report.failures).toEqual([
      { failureClass: "data_fault", jobs: 1, rate: "0.5000" },
    ]);
    const captured = (38n + 598n) * 100n;
    expect(report.grossMargin.capturedValuePaise).toBe(captured);
    expect(report.grossMargin.aiCostPaise).toBe(1760n);
    // Payment fee config "2.00" percent, rounded up; infra cost 0.
    expect(report.grossMargin.paymentFeesPaise).toBe((captured * 2n + 99n) / 100n);
    expect(report.grossMargin.marginPaise).toBe(
      captured - 1760n - report.grossMargin.paymentFeesPaise,
    );
  });

  it("flags stale registry entries", async () => {
    const view = await modelRegistryView(pool(), 30, new Date("2026-12-31T00:00:00Z"));
    expect(view.find((m) => m.modelId === "claude-opus-5")?.stale).toBe(true);
    const fresh = await modelRegistryView(pool(), 30, new Date("2026-09-20T00:00:00Z"));
    expect(fresh.every((m) => !m.stale)).toBe(true);
  });
});
