/**
 * ADR 0045: what a company called its tables, rows and cards is remembered for good, per company.
 * It survives every later run, belongs to that company alone, is never replaced by the product's
 * default because it could not be read, and is never written over by a run that started before
 * the rename. Real Postgres.
 */

import { randomUUID } from "node:crypto";

import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import {
  latestBlueprint,
  storeBlueprint,
  storeSnapshot,
  verifyBlueprintChain,
} from "@magicmis/engine/server";
import { MONTHLY_FINANCIAL_MIS, type TemplateSpec } from "@magicmis/templates";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applyDashboardPatch,
  companyDashboard,
  completeDashboardAddon,
} from "../src/dashboard";
import { advanceJob, confirmJob, createJob, type JobType } from "../src/jobs";
import { completeJob } from "../src/settle";
import { applyTemplatePatch, undoTemplatePatch } from "../src/template-edits";
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

type Scope = { accountId: string; companyId: string };
const ZERO = {
  files: 0,
  sheets: 0,
  columns: 0,
  rows: 0,
  distinctLedgerValues: 0,
  referenceMisSheets: 0,
};
const parts = (recipe: unknown, templateSpec: unknown = MONTHLY_FINANCIAL_MIS) => ({
  templateSpec,
  recipe,
  mappingRules: [],
  dashboardSpec: null,
  materiality: { pct: "0.05" },
  sourceFingerprints: {},
});
const FIRST_ROW = "/sections/0/rows/0/label";
const firstRow = async (c: Scope): Promise<string | undefined> =>
  ((await latestBlueprint(pool(), wrapper, c))?.parts.templateSpec as TemplateSpec)
    .sections[0]?.rows[0]?.label;

async function setUp(c: Scope): Promise<void> {
  await storeBlueprint(pool(), wrapper, {
    ...c,
    jobId: null,
    parts: parts({ v: 1 }),
    basedOn: null,
  });
  await storeSnapshot(pool(), wrapper, {
    ...c,
    jobId: null,
    payload: emptySnapshot("2026-04"),
  });
  await pool().query(`update companies set first_setup_at = now() where id = $1`, [
    c.companyId,
  ]);
}

async function secondCompany(accountId: string): Promise<Scope> {
  const r = await pool().query<{ id: string }>(
    `insert into companies (account_id, name) values ($1, 'Second Company') returning id`,
    [accountId],
  );
  return { accountId, companyId: r.rows[0]?.id ?? "" };
}

async function reservedJob(c: Scope, type: JobType): Promise<string> {
  const job = await createJob(pool(), {
    ...c,
    type,
    tier: "professional",
    delivery: "standard",
    idempotencyKey: randomUUID(),
    size: ZERO,
  });
  await confirmJob(pool(), { accountId: c.accountId, jobId: job.jobId });
  return job.jobId;
}

async function addDashboard(c: Scope): Promise<number> {
  const jobId = await reservedJob(c, "dashboard_addon");
  const done = await completeDashboardAddon(pool(), wrapper, {
    accountId: c.accountId,
    jobId,
  });
  return done.blueprintVersion;
}

/** A run that stores a new blueprint, handing over the template it read when it started. */
async function run(
  c: Scope,
  input: {
    recipe: unknown;
    template?: unknown;
    period: string;
    type?: JobType;
    layout?: "keep" | "replace";
  },
) {
  const jobId = await reservedJob(c, input.type ?? "refresh_with_restructure");
  await advanceJob(pool(), { accountId: c.accountId, jobId, to: "rendering" });
  return completeJob(pool(), wrapper, {
    accountId: c.accountId,
    jobId,
    snapshot: emptySnapshot(input.period),
    blueprint: parts(input.recipe, input.template),
    ...(input.layout === undefined ? {} : { layout: input.layout }),
    output: null,
    outputStore: new MemoryOutputStore(),
  });
}

describe("a company's own names", () => {
  it("survive every later run, even one handed the layout from before the rename", async () => {
    const c = await accountWithCompany(pool(), 50_000n);
    await setUp(c);
    const dashboardVersion = await addDashboard(c);
    const card = await applyDashboardPatch(pool(), wrapper, {
      ...c,
      baseVersion: dashboardVersion,
      operations: [{ op: "replace", path: "/widgets/0/title", value: "Turnover" }],
    });
    const renamed = await applyTemplatePatch(pool(), wrapper, {
      ...c,
      baseVersion: card.blueprintVersion,
      operations: [{ op: "replace", path: FIRST_ROW, value: "Sales" }],
    });

    // The run passes the product's standard layout: what it read before the rename.
    const may = await run(c, { recipe: { v: 2 }, period: "2026-05" });
    expect(may.blueprintVersion).toBe(renamed.blueprintVersion + 1);
    const june = await run(c, { recipe: { v: 3 }, period: "2026-06" });
    expect(june.blueprintVersion).toBe(renamed.blueprintVersion + 2);

    const after = await latestBlueprint(pool(), wrapper, c);
    expect(after?.parts.recipe).toEqual({ v: 3 });
    expect(await firstRow(c)).toBe("Sales");
    expect((await companyDashboard(pool(), wrapper, c))?.spec.widgets[0]?.title).toBe(
      "Turnover",
    );
    // The edit history came along too: the rename can still be undone, runs later.
    const undone = await undoTemplatePatch(pool(), wrapper, {
      ...c,
      baseVersion: june.blueprintVersion ?? 0,
    });
    expect(undone.template.sections[0]?.rows[0]?.label).toBe("Revenue from operations");
    expect(await verifyBlueprintChain(pool(), wrapper, c)).toMatchObject({ ok: true });
  });

  it("belong to one company: another company of the same account keeps its own", async () => {
    const a = await accountWithCompany(pool(), 50_000n);
    const b = await secondCompany(a.accountId);
    await setUp(a);
    await setUp(b);
    await applyTemplatePatch(pool(), wrapper, {
      ...a,
      baseVersion: 1,
      operations: [{ op: "replace", path: FIRST_ROW, value: "Sales" }],
    });
    await applyTemplatePatch(pool(), wrapper, {
      ...b,
      baseVersion: 1,
      operations: [{ op: "replace", path: FIRST_ROW, value: "Fee income" }],
    });
    await run(a, { recipe: { v: 2 }, period: "2026-05" });
    await run(b, { recipe: { v: 2 }, period: "2026-05" });
    expect(await firstRow(a)).toBe("Sales");
    expect(await firstRow(b)).toBe("Fee income");

    // A third company starts from the standard layout, not from either of theirs.
    const third = await secondCompany(a.accountId);
    await setUp(third);
    expect(await firstRow(third)).toBe("Revenue from operations");
  });

  it("are replaced only by the action that asks for a new layout, and the dashboard stays", async () => {
    const c = await accountWithCompany(pool(), 50_000n);
    await setUp(c);
    const dashboardVersion = await addDashboard(c);
    await applyDashboardPatch(pool(), wrapper, {
      ...c,
      baseVersion: dashboardVersion,
      operations: [{ op: "replace", path: "/widgets/0/title", value: "Turnover" }],
    });
    const recreated: TemplateSpec = {
      ...MONTHLY_FINANCIAL_MIS,
      name: "Recreated MIS",
    };
    await run(c, {
      recipe: { v: 2 },
      template: recreated,
      period: "2026-05",
      type: "reference_mis_recreate",
      layout: "replace",
    });
    expect(
      ((await latestBlueprint(pool(), wrapper, c))?.parts.templateSpec as TemplateSpec)
        .name,
    ).toBe("Recreated MIS");
    expect((await companyDashboard(pool(), wrapper, c))?.spec.widgets[0]?.title).toBe(
      "Turnover",
    );
  });
});

describe("a saved layout that cannot be read", () => {
  it("is carried through a finishing run exactly as stored, never swapped for the standard one", async () => {
    // The completion step copies a layout; it never interprets one. A run that has already
    // spent on AI is not failed here, and nothing is lost by the copy: what renders from a
    // layout reads it strictly and earlier (the session loader, before any spend).
    const c = await accountWithCompany(pool(), 50_000n);
    await setUp(c);
    const template = { name: "Ours", sections: "not a list" };
    const dashboard = { spec: { widgets: "not a list" }, parentVersion: null };
    await storeBlueprint(pool(), wrapper, {
      ...c,
      jobId: null,
      parts: { ...parts({ v: 1 }, template), dashboardSpec: dashboard },
      basedOn: 1,
    });
    const done = await run(c, { recipe: { v: 2 }, period: "2026-05" });
    expect(done.blueprintVersion).toBe(3);
    const after = await latestBlueprint(pool(), wrapper, c);
    expect(after?.parts.recipe).toEqual({ v: 2 });
    expect(after?.parts.templateSpec).toEqual(template);
    expect(after?.parts.dashboardSpec).toEqual(dashboard);
  });

  it("stops a paid dashboard job instead of storing the default over it, and charges nothing", async () => {
    const c = await accountWithCompany(pool(), 50_000n);
    await setUp(c);
    const broken = { spec: { widgets: "not a list" }, parentVersion: null };
    await storeBlueprint(pool(), wrapper, {
      ...c,
      jobId: null,
      parts: { ...parts({ v: 1 }), dashboardSpec: broken },
      basedOn: 1,
    });
    // Not "this company has no dashboard": that answer is what offers to build a new one.
    await expect(companyDashboard(pool(), wrapper, c)).rejects.toMatchObject({
      code: "unreadable",
    });
    const before = await wallet(pool(), c.accountId);
    const jobId = await reservedJob(c, "dashboard_addon");
    await expect(
      completeDashboardAddon(pool(), wrapper, { accountId: c.accountId, jobId }),
    ).rejects.toMatchObject({ code: "unreadable" });
    const after = await latestBlueprint(pool(), wrapper, c);
    expect(after?.version).toBe(2);
    expect(after?.parts.dashboardSpec).toEqual(broken);
    // The hold is given back at once, not when the reservation would have lapsed.
    expect(await wallet(pool(), c.accountId)).toEqual({ ...before, held: 0n });
    const job = await pool().query<{ state: string; captured: string | null }>(
      `select state, captured_credits::text as captured from jobs where id = $1`,
      [jobId],
    );
    expect(job.rows[0]).toEqual({ state: "failed_platform", captured: "0" });
  });
});

describe("a rename that lands while a run is finishing", () => {
  it("is kept or refused, never accepted and then lost", async () => {
    for (let round = 0; round < 6; round += 1) {
      const c = await accountWithCompany(pool(), 50_000n);
      await setUp(c);
      const jobId = await reservedJob(c, "refresh_with_restructure");
      await advanceJob(pool(), { accountId: c.accountId, jobId, to: "rendering" });
      const [finished, rename] = await Promise.allSettled([
        completeJob(pool(), wrapper, {
          accountId: c.accountId,
          jobId,
          snapshot: emptySnapshot("2026-05"),
          blueprint: parts({ v: 2 }),
          output: null,
          outputStore: new MemoryOutputStore(),
        }),
        applyTemplatePatch(pool(), wrapper, {
          ...c,
          baseVersion: 1,
          operations: [{ op: "replace", path: FIRST_ROW, value: "Sales" }],
        }),
      ]);
      // The paid run always completes, with its own changes in place.
      expect(finished.status).toBe("fulfilled");
      const after = await latestBlueprint(pool(), wrapper, c);
      expect(after?.parts.recipe).toEqual({ v: 2 });
      if (rename.status === "fulfilled") expect(await firstRow(c)).toBe("Sales");
      else {
        expect(rename.reason).toMatchObject({ code: "stale" });
        expect(await firstRow(c)).toBe("Revenue from operations");
      }
      expect(await verifyBlueprintChain(pool(), wrapper, c)).toMatchObject({ ok: true });
    }
  });
});
