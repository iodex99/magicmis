/**
 * SPEC §34 Phase 7 acceptance: the batch path completes and notifies; post-check failures are
 * repaired once or fail as a platform fault. Real Postgres; a scripted Anthropic transport (no
 * network), so every request the worker would send is inspected.
 */

import { randomUUID } from "node:crypto";

import type { PeriodId } from "@magicmis/core/time";
import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import { storeBlueprint, storeSnapshot } from "@magicmis/engine/server";
import { priceFor } from "@magicmis/wallet";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  commentaryBatchTick,
  commentaryForJob,
  queueCommentary,
  runInstantCommentary,
} from "../src/commentary";
import { confirmJob, createJob } from "../src/jobs";
import { message, ScriptedTransport } from "./ai-helpers";
import { accountWithCompany, emptySnapshot, wallet, wrapper } from "./helpers";

let db: TestDb | undefined;
beforeAll(async () => {
  db = await startTestDb();
  // Tests exercise delivery, not prompt activation (the eval gate is tested in packages/ai).
  await db.pool.query(
    `update tier_routing set prompt_version = 1 where stage = 'commentary'`,
  );
}, 180_000);
afterAll(async () => {
  await db?.stop();
});
const pool = () => {
  if (db === undefined) throw new Error("db not started");
  return db.pool;
};

const PERIOD = "2026-05" as PeriodId;
const ZERO = {
  files: 0,
  sheets: 0,
  columns: 0,
  rows: 0,
  distinctLedgerValues: 0,
  referenceMisSheets: 0,
};
const GOOD = JSON.stringify({
  sections: [
    {
      heading: "Performance",
      paragraphs: [
        {
          text: "Revenue was {{m:revenue@2026-05}}, a change of {{mv:revenue.mom@2026-05:pct}} on last month.",
        },
      ],
    },
  ],
});
const INJECTED = JSON.stringify({
  sections: [
    { heading: "Performance", paragraphs: [{ text: "Revenue fell 12% to ₹7.4 crore." }] },
  ],
});

async function companyWithSnapshot() {
  const c = await accountWithCompany(pool(), 5_000n);
  const snap = emptySnapshot(PERIOD);
  const value = (metricId: string, v: string, unit: "paise" | "percent" = "paise") => ({
    metricId,
    period: PERIOD,
    dims: {},
    value: v,
    nullReason: null,
    unit,
    formula: "",
    inputs: [],
  });
  await storeSnapshot(pool(), wrapper, {
    accountId: c.accountId,
    companyId: c.companyId,
    jobId: null,
    payload: {
      ...snap,
      metricStore: {
        ...snap.metricStore,
        values: [
          value("revenue", "7455550000"),
          value("revenue.mom_abs", "-120000000"),
          value("revenue.mom_pct", "-1.583333", "percent"),
          value("pat", "700000000"),
        ],
      },
    },
  });
  return c;
}

async function commentaryJob(
  c: { accountId: string; companyId: string },
  delivery: "standard" | "instant",
) {
  const job = await createJob(pool(), {
    accountId: c.accountId,
    companyId: c.companyId,
    type: "commentary",
    tier: "professional",
    delivery,
    idempotencyKey: randomUUID(),
    size: ZERO,
  });
  expect(job.state).toBe("estimated");
  await confirmJob(pool(), { accountId: c.accountId, jobId: job.jobId });
  await queueCommentary(pool(), wrapper, {
    accountId: c.accountId,
    jobId: job.jobId,
    period: PERIOD,
  });
  return job.jobId;
}

const state = async (jobId: string) =>
  (
    await pool().query<{ state: string; captured_credits: string | null }>(
      `select state, captured_credits::text as captured_credits from jobs where id = $1`,
      [jobId],
    )
  ).rows[0];

describe("commentary on Standard delivery (Message Batches)", () => {
  it("submits queued jobs as one batch, completes on results, captures and notifies", async () => {
    const a = await companyWithSnapshot();
    const b = await companyWithSnapshot();
    const jobA = await commentaryJob(a, "standard");
    const jobB = await commentaryJob(b, "standard");
    expect((await state(jobA))?.state).toBe("commentary_queued");

    const t = new ScriptedTransport();
    t.countResult = 3000;
    const first = await commentaryBatchTick(pool(), wrapper, t);
    expect(first.submitted).toBe(2);
    expect(t.batches).toHaveLength(1);
    const requests = t.batches[0] ?? [];
    expect(requests.map((r) => r.custom_id).sort()).toEqual(
      [jobA, jobB].map((id) => `job_${id.replace(/-/gu, "")}`).sort(),
    );
    // The request carries the facts pack as data, the structured-output schema, and no free text from the browser.
    const content = JSON.stringify(requests[0]?.params.messages);
    expect(content).toContain("m:revenue@2026-05");
    expect(requests[0]?.params.output_config?.format?.type).toBe("json_schema");

    // Still processing: nothing completes.
    t.batchStatus = "in_progress";
    expect(await commentaryBatchTick(pool(), wrapper, t)).toMatchObject({
      submitted: 0,
      completed: 0,
    });

    // Batch ends: A passes; B's output injected numerals, so it reruns in real time and the repair passes.
    t.batchStatus = "ended";
    t.batchOutput = [
      {
        customId: `job_${jobA.replace(/-/gu, "")}`,
        type: "succeeded",
        message: message(GOOD, { model: "claude-sonnet-5" }),
      },
      {
        customId: `job_${jobB.replace(/-/gu, "")}`,
        type: "succeeded",
        message: message(INJECTED, { model: "claude-sonnet-5" }),
      },
    ];
    t.push(
      { kind: "message", message: message(INJECTED, { model: "claude-sonnet-5" }) },
      { kind: "message", message: message(GOOD, { model: "claude-sonnet-5" }) },
    );
    const done = await commentaryBatchTick(pool(), wrapper, t);
    expect(done).toMatchObject({ completed: 2, retried: 1 });

    const price = (
      await priceFor(pool(), {
        actionKey: "commentary",
        tier: "professional",
        delivery: "standard",
      })
    ).credits;
    for (const [jobId, c] of [
      [jobA, a],
      [jobB, b],
    ] as const) {
      expect(await state(jobId)).toEqual({
        state: "completed",
        captured_credits: price.toString(),
      });
      expect(await wallet(pool(), c.accountId)).toEqual({
        balance: 5_000n - price,
        held: 0n,
      });
      const notice = await pool().query(
        `select type from notifications where account_id = $1 and type = 'job.completed'`,
        [c.accountId],
      );
      expect(notice.rowCount).toBe(1);
      const stored = await commentaryForJob(pool(), wrapper, {
        accountId: c.accountId,
        jobId,
      });
      expect(stored?.output.sections[0]?.paragraphs[0]?.text).toContain(
        "{{m:revenue@2026-05}}",
      );
    }
    // B's repair turn carried the post-check errors.
    expect(JSON.stringify(t.created[1]?.messages)).toContain(
      "contains a number outside a placeholder",
    );
    const calls = await pool().query<{ is_batch: boolean; status: string }>(
      `select is_batch, status from ai_calls where job_id = any($1) order by created_at`,
      [[jobA, jobB]],
    );
    expect(calls.rows.filter((r) => r.is_batch)).toHaveLength(2);
    expect(calls.rows.filter((r) => !r.is_batch).map((r) => r.status)).toEqual([
      "invalid_output",
      "ok",
    ]);
  });

  it("a second post-check failure is a platform fault: nothing charged, nothing stored", async () => {
    const c = await companyWithSnapshot();
    const jobId = await commentaryJob(c, "instant");
    const t = new ScriptedTransport([
      { kind: "message", message: message(INJECTED, { model: "claude-sonnet-5" }) },
      { kind: "message", message: message(INJECTED, { model: "claude-sonnet-5" }) },
    ]);
    expect(
      await runInstantCommentary(pool(), wrapper, t, { accountId: c.accountId, jobId }),
    ).toBe("failed");
    const row = await pool().query<{ state: string; failure_class: string }>(
      `select state, failure_class from jobs where id = $1`,
      [jobId],
    );
    expect(row.rows[0]).toEqual({
      state: "failed_platform",
      failure_class: "platform_fault",
    });
    expect(await wallet(pool(), c.accountId)).toEqual({ balance: 5_000n, held: 0n });
    expect(
      await commentaryForJob(pool(), wrapper, { accountId: c.accountId, jobId }),
    ).toBeNull();
  });

  it("a saved layout that cannot be read stops a paid commentary before any AI call and releases the hold", async () => {
    const c = await companyWithSnapshot();
    await storeBlueprint(pool(), wrapper, {
      ...c,
      jobId: null,
      parts: {
        templateSpec: { name: "Ours", defaultCommentarySections: "not a list" },
        recipe: {},
        mappingRules: [],
        dashboardSpec: null,
        materiality: {},
        sourceFingerprints: {},
      },
      basedOn: null,
    });
    // Not structured by the standard headings instead, as it used to be.
    await expect(commentaryJob(c, "instant")).rejects.toMatchObject({
      code: "unreadable",
    });
    expect(await wallet(pool(), c.accountId)).toEqual({ balance: 5_000n, held: 0n });
    const jobs = await pool().query<{ state: string }>(
      `select state from jobs where company_id = $1`,
      [c.companyId],
    );
    expect(jobs.rows).toEqual([{ state: "failed_platform" }]);
  });

  it("Instant delivery completes in the request", async () => {
    const c = await companyWithSnapshot();
    const jobId = await commentaryJob(c, "instant");
    const t = new ScriptedTransport([
      { kind: "message", message: message(GOOD, { model: "claude-sonnet-5" }) },
    ]);
    expect(
      await runInstantCommentary(pool(), wrapper, t, { accountId: c.accountId, jobId }),
    ).toBe("completed");
    expect((await state(jobId))?.state).toBe("completed");
  });
});
