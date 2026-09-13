/**
 * SPEC §34 Phase 6 acceptance: failure classes bill exactly per Section 23. Prices are read from
 * the seeded price book, never restated here: company_setup (999 × tier multiplier),
 * data_diagnostic (299 × multiplier), cancel_after_ai_fee (= data_diagnostic).
 */

import { randomUUID } from "node:crypto";

import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import { priceFor } from "@magicmis/wallet";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  acceptJobQuote,
  advanceJob,
  confirmJob,
  createJob,
  heartbeatJob,
} from "../src/jobs";
import { cancelJob, completeJob, failJob, sweepJobs } from "../src/settle";
import { JobStateError } from "../src/states";
import {
  accountWithCompany,
  addAiCall,
  emptySnapshot,
  MemoryOutputStore,
  SMALL,
  wallet,
  wrapper,
} from "./helpers";

let db: TestDb | undefined;
beforeAll(async () => {
  db = await startTestDb();
}, 180_000);
afterAll(async () => {
  await db?.stop();
});
const pool = () => {
  if (db === undefined) throw new Error("db not started");
  return db.pool;
};

const price = async (
  actionKey: "company_setup" | "data_diagnostic" | "cancel_after_ai_fee",
  tier: "efficient" | "professional" | "expert" = "professional",
) => (await priceFor(pool(), { actionKey, tier, delivery: "instant" })).credits;

async function reservedJob(
  credits = 10_000n,
  tier: "efficient" | "professional" | "expert" = "professional",
) {
  const { accountId, companyId } = await accountWithCompany(pool(), credits);
  const created = await createJob(pool(), {
    accountId,
    companyId,
    type: "company_setup",
    tier,
    delivery: "instant",
    idempotencyKey: randomUUID(),
    size: SMALL,
  });
  expect(created.state).toBe("estimated");
  await confirmJob(pool(), { accountId, jobId: created.jobId });
  return { accountId, companyId, jobId: created.jobId };
}

async function jobRow(jobId: string) {
  const r = await pool().query<{
    state: string;
    failure_class: string | null;
    captured_credits: string | null;
  }>(
    `select state, failure_class, captured_credits::text as captured_credits from jobs where id = $1`,
    [jobId],
  );
  return r.rows[0];
}

describe("pricing and reservation", () => {
  it("creates at the price-book price, holds exactly that, and is idempotent", async () => {
    const { accountId, companyId } = await accountWithCompany(pool(), 5_000n);
    const key = randomUUID();
    const a = await createJob(pool(), {
      accountId,
      companyId,
      type: "company_setup",
      tier: "professional",
      delivery: "instant",
      idempotencyKey: key,
      size: SMALL,
    });
    const b = await createJob(pool(), {
      accountId,
      companyId,
      type: "company_setup",
      tier: "professional",
      delivery: "instant",
      idempotencyKey: key,
      size: SMALL,
    });
    expect(b).toMatchObject({ jobId: a.jobId, duplicate: true });
    expect(a.priceCredits).toBe(await price("company_setup"));
    await confirmJob(pool(), { accountId, jobId: a.jobId });
    await confirmJob(pool(), { accountId, jobId: a.jobId });
    expect(await wallet(pool(), accountId)).toEqual({
      balance: 5_000n,
      held: a.priceCredits,
    });
  });

  it("a setup with a reference MIS costs setup plus the recreate add-on, on completion too", async () => {
    const { accountId, companyId } = await accountWithCompany(pool(), 5_000n);
    const job = await createJob(pool(), {
      accountId,
      companyId,
      type: "reference_mis_recreate",
      tier: "professional",
      delivery: "instant",
      idempotencyKey: randomUUID(),
      size: { ...SMALL, referenceMisSheets: 2 },
    });
    const addon = (
      await priceFor(pool(), {
        actionKey: "reference_mis_recreate",
        tier: "professional",
        delivery: "instant",
      })
    ).credits;
    const total = (await price("company_setup")) + addon;
    expect(job.priceCredits).toBe(total);
    await confirmJob(pool(), { accountId, jobId: job.jobId });
    await advanceJob(pool(), { accountId, jobId: job.jobId, to: "rendering" });
    const done = await completeJob(pool(), wrapper, {
      accountId,
      jobId: job.jobId,
      snapshot: emptySnapshot("2026-05"),
      blueprint: null,
      output: null,
      outputStore: new MemoryOutputStore(),
    });
    expect(done.captured).toBe(total);
    expect(await wallet(pool(), accountId)).toEqual({
      balance: 5_000n - total,
      held: 0n,
    });
  });

  it("refuses with a shortfall when credits are insufficient, holding nothing", async () => {
    const { accountId, companyId } = await accountWithCompany(pool(), 10n);
    const job = await createJob(pool(), {
      accountId,
      companyId,
      type: "company_setup",
      tier: "professional",
      delivery: "instant",
      idempotencyKey: randomUUID(),
      size: SMALL,
    });
    await expect(
      confirmJob(pool(), { accountId, jobId: job.jobId }),
    ).rejects.toMatchObject({ code: "insufficient_credits" });
    expect(await wallet(pool(), accountId)).toEqual({ balance: 10n, held: 0n });
  });

  it("offers a quote when the p90 estimate exceeds the AI cost cap, and reserves the quote on acceptance", async () => {
    const { accountId, companyId } = await accountWithCompany(pool(), 100_000n);
    const huge = {
      files: 40,
      sheets: 400,
      columns: 30_000,
      rows: 5_000_000,
      distinctLedgerValues: 200_000,
      referenceMisSheets: 0,
    };
    const job = await createJob(pool(), {
      accountId,
      companyId,
      type: "company_setup",
      tier: "expert",
      delivery: "instant",
      idempotencyKey: randomUUID(),
      size: huge,
    });
    expect(job.state).toBe("needs_quote");
    expect(job.quote?.credits).toBeGreaterThan(job.priceCredits);
    await expect(
      confirmJob(pool(), { accountId, jobId: job.jobId }),
    ).rejects.toBeInstanceOf(JobStateError);
    await acceptJobQuote(pool(), { accountId, jobId: job.jobId });
    expect((await wallet(pool(), accountId)).held).toBe(job.quote?.credits);
  });

  it("never lets the browser skip backwards or into a settled state", async () => {
    const { accountId, jobId } = await reservedJob();
    await advanceJob(pool(), { accountId, jobId, to: "profiling" });
    await expect(
      advanceJob(pool(), { accountId, jobId, to: "preflight" }),
    ).rejects.toMatchObject({ code: "invalid_transition" });
    await expect(
      advanceJob(pool(), { accountId, jobId, to: "completed" }),
    ).rejects.toMatchObject({ code: "invalid_transition" });
    expect(await heartbeatJob(pool(), { accountId, jobId })).toBe(true);
    const other = await accountWithCompany(pool(), 0n);
    await expect(
      advanceJob(pool(), { accountId: other.accountId, jobId, to: "mapping" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("charge points (SPEC §23)", () => {
  it("completed: captures the full price and releases nothing else", async () => {
    const { accountId, jobId } = await reservedJob();
    for (const s of [
      "preflight",
      "profiling",
      "classifying",
      "mapping",
      "computing",
      "validating",
      "rendering",
    ] as const) {
      await advanceJob(pool(), { accountId, jobId, to: s });
    }
    const result = await completeJob(pool(), wrapper, {
      accountId,
      jobId,
      snapshot: emptySnapshot("2026-04"),
      blueprint: null,
      output: { fileName: "x.xlsx", bytes: Buffer.from("xlsx bytes") },
      outputStore: new MemoryOutputStore(),
    });
    const full = await price("company_setup");
    expect(result.captured).toBe(full);
    expect(await jobRow(jobId)).toMatchObject({
      state: "completed",
      captured_credits: full.toString(),
    });
    expect(await wallet(pool(), accountId)).toEqual({
      balance: 10_000n - full,
      held: 0n,
    });
  });

  it("completed on a lower tier's model: captures the delivered tier's price", async () => {
    const { accountId, jobId } = await reservedJob(10_000n, "expert");
    await pool().query(
      `update jobs set state = 'rendering', stage_checkpoints = stage_checkpoints || '{"delivered_tier":"professional"}' where id = $1`,
      [jobId],
    );
    const result = await completeJob(pool(), wrapper, {
      accountId,
      jobId,
      snapshot: emptySnapshot("2026-04"),
      blueprint: null,
      output: null,
      outputStore: new MemoryOutputStore(),
    });
    expect(result.captured).toBe(await price("company_setup", "professional"));
    expect(result.captured).toBeLessThan(await price("company_setup", "expert"));
  });

  it("data fault in preflight or later: captures the data_diagnostic price only", async () => {
    for (const at of ["preflight", "validating"] as const) {
      const { accountId, jobId } = await reservedJob();
      await advanceJob(pool(), { accountId, jobId, to: at });
      const r = await failJob(pool(), {
        accountId,
        jobId,
        failureClass: "data_fault",
        code: "V3",
        detail: "Trial balance does not balance",
        reportedBy: "browser",
      });
      const diag = await price("data_diagnostic");
      expect(r).toMatchObject({ state: "failed_data", captured: diag });
      expect(await wallet(pool(), accountId)).toEqual({
        balance: 10_000n - diag,
        held: 0n,
      });
      expect(await jobRow(jobId)).toMatchObject({ failure_class: "data_fault" });
    }
  });

  it("platform fault: releases everything and records absorbed AI cost", async () => {
    const { accountId, jobId } = await reservedJob();
    await advanceJob(pool(), { accountId, jobId, to: "classifying" });
    await addAiCall(pool(), accountId, jobId);
    const r = await failJob(pool(), {
      accountId,
      jobId,
      failureClass: "platform_fault",
      code: "ai_invalid_output",
      detail: "",
      reportedBy: "server",
    });
    expect(r).toMatchObject({ state: "failed_platform", captured: 0n });
    expect(await wallet(pool(), accountId)).toEqual({ balance: 10_000n, held: 0n });
    const absorbed = await pool().query(
      `select kind, cost_micro_usd::text from margin_events where job_id = $1`,
      [jobId],
    );
    expect(absorbed.rows).toEqual([
      { kind: "platform_absorbed", cost_micro_usd: "20000" },
    ]);
  });

  it("browser-reported platform faults beyond the window limit are charged as data faults and flagged", async () => {
    const { accountId, companyId } = await accountWithCompany(pool(), 50_000n);
    const limit = 3;
    const outcomes: string[] = [];
    for (let i = 0; i <= limit; i += 1) {
      const job = await createJob(pool(), {
        accountId,
        companyId,
        type: "company_setup",
        tier: "professional",
        delivery: "instant",
        idempotencyKey: randomUUID(),
        size: SMALL,
      });
      await confirmJob(pool(), { accountId, jobId: job.jobId });
      const r = await failJob(pool(), {
        accountId,
        jobId: job.jobId,
        failureClass: "platform_fault",
        code: "render_failed",
        detail: "",
        reportedBy: "browser",
      });
      outcomes.push(r.state);
    }
    expect(outcomes).toEqual([
      "failed_platform",
      "failed_platform",
      "failed_platform",
      "failed_data",
    ]);
    const audit = await pool().query<{ n: number }>(
      `select count(*)::int as n from audit_log where action = 'job.platform_fault_limit_reached'`,
    );
    expect(audit.rows[0]?.n).toBeGreaterThanOrEqual(1);
  });

  it("cancelled before any AI call releases everything; after an AI call captures cancel_after_ai_fee", async () => {
    const before = await reservedJob();
    expect(await cancelJob(pool(), before)).toEqual({ captured: 0n });
    expect(await wallet(pool(), before.accountId)).toEqual({
      balance: 10_000n,
      held: 0n,
    });

    const after = await reservedJob();
    await advanceJob(pool(), { ...after, to: "classifying" });
    await addAiCall(pool(), after.accountId, after.jobId);
    const fee = await price("cancel_after_ai_fee");
    expect(fee).toBe(await price("data_diagnostic"));
    expect(await cancelJob(pool(), after)).toEqual({ captured: fee });
    expect(await wallet(pool(), after.accountId)).toEqual({
      balance: 10_000n - fee,
      held: 0n,
    });
    expect(await jobRow(after.jobId)).toMatchObject({
      state: "cancelled",
      failure_class: "user_cancelled",
    });
  });

  it("expired awaiting review: reminded first, then charged as cancelled after an AI call", async () => {
    const { accountId, jobId } = await reservedJob();
    for (const s of ["preflight", "classifying", "mapping"] as const)
      await advanceJob(pool(), { accountId, jobId, to: s });
    await addAiCall(pool(), accountId, jobId);
    const t0 = new Date();
    await advanceJob(pool(), { accountId, jobId, to: "awaiting_review", now: t0 });
    const expires = await pool().query<{ expires_at: Date; kind: string }>(
      `select r.expires_at, r.kind from reservations r join jobs j on j.reservation_id = r.id where j.id = $1`,
      [jobId],
    );
    expect(expires.rows[0]?.kind).toBe("review");
    const expiry = expires.rows[0]?.expires_at ?? t0;
    expect(expiry.getTime() - t0.getTime()).toBe(72 * 3_600_000);

    const reminder = await sweepJobs(pool(), new Date(expiry.getTime() - 12 * 3_600_000));
    expect(reminder).toEqual({ expired: 0, reminded: 1 });
    const swept = await sweepJobs(pool(), new Date(expiry.getTime() + 3_600_000));
    expect(swept.expired).toBe(1);
    const fee = await price("cancel_after_ai_fee");
    expect(await jobRow(jobId)).toMatchObject({
      state: "expired",
      failure_class: "expired",
      captured_credits: fee.toString(),
    });
    expect(await wallet(pool(), accountId)).toEqual({ balance: 10_000n - fee, held: 0n });
  });

  it("a capture never exceeds the hold", async () => {
    const { accountId, jobId } = await reservedJob(10_000n, "efficient");
    await pool().query(
      `update reservations set amount = 50 where id = (select reservation_id from jobs where id = $1)`,
      [jobId],
    );
    await pool().query(`update wallets set held_credits = 50 where account_id = $1`, [
      accountId,
    ]);
    const r = await failJob(pool(), {
      accountId,
      jobId,
      failureClass: "data_fault",
      code: "V8",
      detail: "",
      reportedBy: "server",
    });
    expect(r.captured).toBe(50n);
  });
});
