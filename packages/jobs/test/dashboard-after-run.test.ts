/**
 * ADR 0047: a completed run puts its figures on the dashboard in the same press, as the
 * dashboard's own priced action. Money logic: every ordering is tested. Real Postgres.
 */

import { randomUUID } from "node:crypto";

import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import { storeBlueprint, storeSnapshot } from "@magicmis/engine/server";
import { MONTHLY_FINANCIAL_MIS } from "@magicmis/templates";
import { priceFor } from "@magicmis/wallet";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { companyDashboard } from "../src/dashboard";
import { bringDashboardUpToDate } from "../src/dashboard-after-run";
import { accountWithCompany, emptySnapshot, wallet, wrapper } from "./helpers";

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

type Scope = { accountId: string; companyId: string };
const month = (c: Scope, period: string) =>
  storeSnapshot(pool(), wrapper, { ...c, jobId: null, payload: emptySnapshot(period) });

async function setUp(credits: bigint, dashboardSpec: unknown = null): Promise<Scope> {
  const c = await accountWithCompany(pool(), credits);
  await storeBlueprint(pool(), wrapper, {
    ...c,
    jobId: null,
    parts: {
      templateSpec: MONTHLY_FINANCIAL_MIS,
      recipe: {},
      mappingRules: [],
      dashboardSpec,
      materiality: {},
      sourceFingerprints: {},
    },
    basedOn: null,
  });
  await pool().query(`update companies set first_setup_at = now() where id = $1`, [
    c.companyId,
  ]);
  await month(c, "2026-04");
  return c;
}
const price = async (actionKey: "dashboard_addon" | "dashboard_refresh") =>
  (await priceFor(pool(), { actionKey, tier: "professional", delivery: "standard" }))
    .credits;
const jobs = async (c: Scope) =>
  (
    await pool().query<{ type: string; state: string; captured: string | null }>(
      `select type, state, captured_credits::text as captured from jobs where company_id = $1 order by created_at`,
      [c.companyId],
    )
  ).rows;

describe("the dashboard after a run", () => {
  it("is built the first time and refreshed after, each at its own price, with nothing left held", async () => {
    const c = await setUp(5_000n);
    const [addon, refresh] = [
      await price("dashboard_addon"),
      await price("dashboard_refresh"),
    ];

    const first = await bringDashboardUpToDate(pool(), wrapper, {
      ...c,
      runJobId: randomUUID(),
    });
    expect(first).toEqual({
      status: "updated",
      capturedCredits: addon.toString(),
      first: true,
    });
    expect((await companyDashboard(pool(), wrapper, c))?.dataThrough).toBe("2026-04");

    await month(c, "2026-05");
    const second = await bringDashboardUpToDate(pool(), wrapper, {
      ...c,
      runJobId: randomUUID(),
    });
    expect(second).toEqual({
      status: "updated",
      capturedCredits: refresh.toString(),
      first: false,
    });
    expect((await companyDashboard(pool(), wrapper, c))?.dataThrough).toBe("2026-05");
    expect(await wallet(pool(), c.accountId)).toEqual({
      balance: 5_000n - addon - refresh,
      held: 0n,
    });
  });

  it("charges for a back-dated file too: new figures reach the board though the latest month did not move", async () => {
    const c = await setUp(5_000n);
    await bringDashboardUpToDate(pool(), wrapper, { ...c, runJobId: randomUUID() });
    const before = await wallet(pool(), c.accountId);
    await month(c, "2026-02");
    const r = await bringDashboardUpToDate(pool(), wrapper, {
      ...c,
      runJobId: randomUUID(),
    });
    expect(r).toMatchObject({ status: "updated", first: false });
    expect((await wallet(pool(), c.accountId)).balance).toBe(
      before.balance - (await price("dashboard_refresh")),
    );
    expect((await companyDashboard(pool(), wrapper, c))?.dataThrough).toBe("2026-04");
  });

  it("is delivered and charged once per run, however many times the run's request is retried", async () => {
    const c = await setUp(5_000n);
    const runJobId = randomUUID();
    const first = await bringDashboardUpToDate(pool(), wrapper, { ...c, runJobId });
    const again = await bringDashboardUpToDate(pool(), wrapper, { ...c, runJobId });
    expect(again).toEqual(first);
    expect(await jobs(c)).toHaveLength(1);
    expect(await wallet(pool(), c.accountId)).toEqual({
      balance: 5_000n - (await price("dashboard_addon")),
      held: 0n,
    });
  });

  it("holds and charges nothing when the wallet cannot cover it, and leaves the board as it was", async () => {
    const c = await setUp(10n);
    const r = await bringDashboardUpToDate(pool(), wrapper, {
      ...c,
      runJobId: randomUUID(),
    });
    expect(r).toEqual({ status: "short" });
    expect(await wallet(pool(), c.accountId)).toEqual({ balance: 10n, held: 0n });
    expect(await companyDashboard(pool(), wrapper, c)).toBeNull();
  });

  it("never strands a hold: a failure after the credits are held releases them at once", async () => {
    const c = await setUp(5_000n);
    // The store refuses the new dashboard version: delivery fails after the hold was taken.
    await pool().query(
      `create trigger blueprints_boom before insert on blueprints for each row when (new.company_id = '${c.companyId}') execute function app.forbid_mutation()`,
    );
    try {
      const r = await bringDashboardUpToDate(pool(), wrapper, {
        ...c,
        runJobId: randomUUID(),
      });
      expect(r).toEqual({ status: "failed" });
    } finally {
      await pool().query(`drop trigger blueprints_boom on blueprints`);
    }
    expect(await wallet(pool(), c.accountId)).toEqual({ balance: 5_000n, held: 0n });
    expect(await jobs(c)).toEqual([
      { type: "dashboard_addon", state: "failed_platform", captured: "0" },
    ]);
  });

  it("does not touch a saved dashboard it cannot read, and takes no hold for it", async () => {
    const c = await setUp(5_000n, {
      spec: { widgets: "not a list" },
      parentVersion: null,
    });
    const r = await bringDashboardUpToDate(pool(), wrapper, {
      ...c,
      runJobId: randomUUID(),
    });
    expect(r).toEqual({ status: "failed" });
    expect(await wallet(pool(), c.accountId)).toEqual({ balance: 5_000n, held: 0n });
    expect(await jobs(c)).toEqual([]);
  });
});
