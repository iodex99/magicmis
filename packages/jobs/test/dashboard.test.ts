/**
 * SPEC §24.2: the dashboard add-on is a paid job; every patch is validated and stored as a new
 * blueprint version; undo restores the previous dashboard as another new version. Real Postgres.
 */

import { randomUUID } from "node:crypto";

import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import { latestBlueprint, storeBlueprint } from "@magicmis/engine/server";
import { DEFAULT_DASHBOARD } from "@magicmis/render-dashboard";
import { priceFor } from "@magicmis/wallet";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applyDashboardPatch,
  companyDashboard,
  completeDashboardAddon,
  previewDashboardPatch,
  undoDashboard,
} from "../src/dashboard";
import { advanceJob, confirmJob, createJob } from "../src/jobs";
import { completeJob } from "../src/settle";
import {
  accountWithCompany,
  emptySnapshot,
  MemoryOutputStore,
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

const ZERO = {
  files: 0,
  sheets: 0,
  columns: 0,
  rows: 0,
  distinctLedgerValues: 0,
  referenceMisSheets: 0,
};
const PARTS = {
  templateSpec: { id: "monthly_financial_mis" },
  recipe: { v: 1 },
  mappingRules: [],
  dashboardSpec: null,
  materiality: { pct: "0.05" },
  sourceFingerprints: {},
};

async function companyWithDashboard() {
  const c = await accountWithCompany(pool(), 5_000n);
  await storeBlueprint(pool(), wrapper, { ...c, jobId: null, parts: PARTS });
  const job = await createJob(pool(), {
    ...c,
    type: "dashboard_addon",
    tier: "professional",
    delivery: "standard",
    idempotencyKey: randomUUID(),
    size: ZERO,
  });
  await confirmJob(pool(), { accountId: c.accountId, jobId: job.jobId });
  const done = await completeDashboardAddon(pool(), wrapper, {
    accountId: c.accountId,
    jobId: job.jobId,
  });
  return { ...c, jobId: job.jobId, done };
}

describe("dashboard add-on", () => {
  it("captures the price, stores the default dashboard as a new blueprint version, and is idempotent", async () => {
    const c = await companyWithDashboard();
    const price = (
      await priceFor(pool(), {
        actionKey: "dashboard_addon",
        tier: "professional",
        delivery: "standard",
      })
    ).credits;
    expect(c.done).toEqual({ captured: price, blueprintVersion: 2 });
    expect(await wallet(pool(), c.accountId)).toEqual({
      balance: 5_000n - price,
      held: 0n,
    });

    const again = await completeDashboardAddon(pool(), wrapper, {
      accountId: c.accountId,
      jobId: c.jobId,
    });
    expect(again).toEqual(c.done);
    expect(await wallet(pool(), c.accountId)).toEqual({
      balance: 5_000n - price,
      held: 0n,
    });

    expect(await companyDashboard(pool(), wrapper, c)).toEqual({
      blueprintVersion: 2,
      spec: DEFAULT_DASHBOARD,
      canUndo: false,
    });
    // The rest of the blueprint is unchanged.
    expect((await latestBlueprint(pool(), wrapper, c))?.parts.recipe).toEqual({ v: 1 });
  });

  it("requires a confirmed price", async () => {
    const c = await accountWithCompany(pool(), 5_000n);
    await storeBlueprint(pool(), wrapper, { ...c, jobId: null, parts: PARTS });
    const job = await createJob(pool(), {
      ...c,
      type: "dashboard_addon",
      tier: "professional",
      delivery: "standard",
      idempotencyKey: randomUUID(),
      size: ZERO,
    });
    await expect(
      completeDashboardAddon(pool(), wrapper, {
        accountId: c.accountId,
        jobId: job.jobId,
      }),
    ).rejects.toThrow(/Confirm the price/u);
    expect(await companyDashboard(pool(), wrapper, c)).toBeNull();
  });
});

describe("dashboard patches and undo", () => {
  const rename = (title: string) => [
    { op: "replace", path: "/widgets/0/title", value: title },
  ];

  it("previews without storing, applies as new versions, and undoes step by step", async () => {
    const c = await companyWithDashboard();
    const preview = await previewDashboardPatch(pool(), wrapper, {
      ...c,
      baseVersion: 2,
      operations: rename("Sales"),
    });
    expect(preview.spec.widgets[0]?.title).toBe("Sales");
    expect((await companyDashboard(pool(), wrapper, c))?.blueprintVersion).toBe(2);

    const v3 = await applyDashboardPatch(pool(), wrapper, {
      ...c,
      baseVersion: 2,
      operations: rename("Sales"),
    });
    const v4 = await applyDashboardPatch(pool(), wrapper, {
      ...c,
      baseVersion: 3,
      operations: rename("Turnover"),
    });
    expect([v3.blueprintVersion, v4.blueprintVersion]).toEqual([3, 4]);

    const u5 = await undoDashboard(pool(), wrapper, { ...c, baseVersion: 4 });
    expect(u5).toMatchObject({ blueprintVersion: 5, canUndo: true });
    expect(u5.spec.widgets[0]?.title).toBe("Sales");
    const u6 = await undoDashboard(pool(), wrapper, { ...c, baseVersion: 5 });
    expect(u6).toMatchObject({ blueprintVersion: 6, canUndo: false });
    expect(u6.spec).toEqual(DEFAULT_DASHBOARD);
    await expect(
      undoDashboard(pool(), wrapper, { ...c, baseVersion: 6 }),
    ).rejects.toThrow(/no earlier dashboard/u);
  });

  it("rejects invalid patches and stale versions without storing", async () => {
    const c = await companyWithDashboard();
    await expect(
      applyDashboardPatch(pool(), wrapper, {
        ...c,
        baseVersion: 2,
        operations: [{ op: "add", path: "/widgets/0/html", value: "<script>" }],
      }),
    ).rejects.toMatchObject({ code: "invalid_patch" });
    await expect(
      applyDashboardPatch(pool(), wrapper, {
        ...c,
        baseVersion: 2,
        operations: [{ op: "add", path: "/__proto__/x", value: 1 }],
      }),
    ).rejects.toMatchObject({ code: "invalid_patch" });
    await expect(
      applyDashboardPatch(pool(), wrapper, {
        ...c,
        baseVersion: 1,
        operations: rename("X"),
      }),
    ).rejects.toMatchObject({ code: "stale" });
    expect((await companyDashboard(pool(), wrapper, c))?.blueprintVersion).toBe(2);
  });

  it("a restructure that stores a new blueprint keeps the dashboard", async () => {
    const c = await companyWithDashboard();
    await pool().query(`update companies set first_setup_at = now() where id = $1`, [c.companyId]);
    const job = await createJob(pool(), {
      ...c,
      type: "refresh_with_restructure",
      tier: "professional",
      delivery: "standard",
      idempotencyKey: randomUUID(),
      size: ZERO,
    });
    await confirmJob(pool(), { accountId: c.accountId, jobId: job.jobId });
    await advanceJob(pool(), { accountId: c.accountId, jobId: job.jobId, to: "rendering" });
    const done = await completeJob(pool(), wrapper, {
      accountId: c.accountId,
      jobId: job.jobId,
      snapshot: emptySnapshot("2026-05"),
      blueprint: { ...PARTS, recipe: { v: 2 } },
      output: null,
      outputStore: new MemoryOutputStore(),
    });
    expect(done.blueprintVersion).toBe(3);
    const after = await latestBlueprint(pool(), wrapper, c);
    expect(after?.parts.recipe).toEqual({ v: 2 });
    expect(await companyDashboard(pool(), wrapper, c)).toMatchObject({
      blueprintVersion: 3,
      spec: DEFAULT_DASHBOARD,
    });
  });
});
