/**
 * SPEC §34 Phase 6 acceptance: setup, then refresh with zero AI calls on a matching fixture.
 *
 * The browser half runs the production pipeline (`@magicmis/pipeline`: SheetJS, Tally parsing,
 * party tokenisation, cascade, DuckDB-WASM compute, validation, ExcelJS workbook with V11); the
 * server half runs the production job functions against real Postgres. No AI transport exists in
 * this test at all: if either job needed Claude, the pipeline would report unmatched ledgers or
 * unrecognised sheets and the test would fail.
 */

import { randomBytes, randomUUID } from "node:crypto";

import type { PeriodId } from "@magicmis/core/time";
import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import { gateOutcome } from "@magicmis/engine";
import {
  latestBlueprint,
  latestSnapshot,
  type BlueprintParts,
} from "@magicmis/engine/server";
import { buildFixtureSet } from "@magicmis/fixtures";
import {
  computeAndRender,
  mapStep,
  nextRules,
  prepare,
  validate,
  type PipelineFile,
  type PriorBalance,
} from "@magicmis/pipeline";
import { Redactor } from "@magicmis/redact";
import {
  GLOBAL_LIBRARY_SEED,
  HEADS_VERSION,
  mappingRulesSchema,
} from "@magicmis/semantic";
import { MONTHLY_FINANCIAL_MIS } from "@magicmis/templates";
import { priceFor } from "@magicmis/wallet";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openTestDuck } from "../../ingest/test/duck";
import { advanceJob, confirmJob, createJob } from "../src/jobs";
import { completeJob } from "../src/settle";
import { accountWithCompany, MemoryOutputStore, wallet, wrapper } from "./helpers";

let db: TestDb | undefined;
let duck: Awaited<ReturnType<typeof openTestDuck>> | undefined;
beforeAll(async () => {
  db = await startTestDb();
  duck = await openTestDuck();
}, 180_000);
afterAll(async () => {
  duck?.close();
  await db?.stop();
});
const pool = () => {
  if (db === undefined) throw new Error("db not started");
  return db.pool;
};

const set = buildFixtureSet({ companies: ["trading"] });
const tbFile = (month: string): PipelineFile => {
  const f = set.files.find(
    (x) =>
      x.report === "trial_balance" &&
      x.variant === "clean" &&
      x.period.to.startsWith(month),
  );
  if (f === undefined) throw new Error(`no TB for ${month}`);
  return {
    fileId: randomUUID(),
    name: f.name.split("/").pop() ?? f.name,
    bytes: f.bytes(),
  };
};

const VALIDATION = {
  tbTolerancePaise: 0n,
  reconciliationTolerancePaise: 0n,
  signSanityHeads: ["REV", "EMP", "OPEX", "CA_CASH"],
  ageingBuckets: [
    [0, 30],
    [31, 60],
    [61, 90],
    [91, 180],
    [181, null],
  ] as const,
};

async function aiCalls(jobId: string): Promise<number> {
  const r = await pool().query<{ n: number }>(
    `select count(*)::int as n from ai_calls where job_id = $1`,
    [jobId],
  );
  return r.rows[0]?.n ?? -1;
}

describe("setup then refresh", () => {
  it("runs both jobs end to end, and the refresh on a matching fixture makes zero AI calls", async () => {
    if (duck === undefined) throw new Error("duck not open");
    const conn = duck;
    const { accountId, companyId } = await accountWithCompany(pool(), 20_000n);
    const redactor = await Redactor.create(randomBytes(32));
    const outputStore = new MemoryOutputStore();
    const setupMonths = [
      "2025-04",
      "2025-05",
      "2025-06",
      "2025-07",
      "2025-08",
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
    ];

    // ---------------- Setup ----------------
    const setupPrepared = await prepare(setupMonths.map(tbFile), redactor);
    expect(setupPrepared.unrecognised).toEqual([]);
    expect(setupPrepared.facts.some((f) => f.name.startsWith("PARTY_"))).toBe(true);
    expect(setupPrepared.facts.some((f) => f.name.includes("Northwind"))).toBe(false);

    const setup = await createJob(pool(), {
      accountId,
      companyId,
      type: "company_setup",
      tier: "professional",
      delivery: "instant",
      idempotencyKey: randomUUID(),
      size: setupPrepared.size,
      sourceFingerprints: setupPrepared.fingerprints,
    });
    expect(setup.state).toBe("estimated");
    await confirmJob(pool(), { accountId, jobId: setup.jobId });
    for (const s of ["preflight", "profiling", "classifying", "mapping"] as const)
      await advanceJob(pool(), { accountId, jobId: setup.jobId, to: s });

    const display = (token: string) => {
      const r = redactor.rehydrate(token);
      return r.name ?? token;
    };
    const setupMap = mapStep(setupPrepared, {
      companyRules: [],
      accountRules: [],
      library: GLOBAL_LIBRARY_SEED,
      fuzzyThreshold: "0.85",
      previous: null,
      displayName: display,
    });
    expect(setupMap.unmatched).toEqual([]);
    await advanceJob(pool(), { accountId, jobId: setup.jobId, to: "awaiting_review" });
    // The user accepts every proposal (some rows are flagged for review).
    const confirmed = setupMap.reviewRows.map((r) => ({
      ledgerKey: r.ledgerKey,
      head: r.proposed.head,
      applyToAllCompanies: false,
    }));
    const names = new Map(setupPrepared.facts.map((f) => [f.ledgerKey, f.name]));
    const { rules } = nextRules(null, setupMap.mappings, confirmed, names, HEADS_VERSION);
    await advanceJob(pool(), { accountId, jobId: setup.jobId, to: "computing" });

    const setupOut = await computeAndRender(conn, setupPrepared, {
      mappings: setupMap.mappings,
      prior: [],
      fyStartMonth: 4,
      period: "2026-04" as PeriodId,
      template: MONTHLY_FINANCIAL_MIS,
      companyName: "Synthetic Hardware Traders",
      tierLabel: "Professional",
      snapshotVersion: 1,
      generatedAt: new Date(),
      displayName: display,
      ageingBuckets: VALIDATION.ageingBuckets,
      validation: (cube) =>
        validate(cube, setupPrepared, {
          config: VALIDATION,
          unmappedAccepted: false,
          expected: { from: "2025-04" as PeriodId, to: "2026-04" as PeriodId },
          previousSnapshot: null,
          netProfitStatements: [],
        }),
    });
    expect(gateOutcome(setupOut.checks)).toEqual({ ok: true });
    expect(setupOut.v11.status).toBe("pass");
    await advanceJob(pool(), { accountId, jobId: setup.jobId, to: "validating" });
    await advanceJob(pool(), { accountId, jobId: setup.jobId, to: "rendering" });

    const blueprint: BlueprintParts = {
      templateSpec: MONTHLY_FINANCIAL_MIS,
      recipe: {
        schemaVersion: 1,
        sources: [
          {
            id: "tb",
            role: "trial_balance",
            sheetSignature: Object.values(setupPrepared.fingerprints)[0] ?? "",
            columns: {},
            sign: "split_columns",
          },
        ],
        filters: [],
        mappingRulesVersion: 1,
        period: { fyStartMonth: 4, granularity: "month" },
        dimensions: [],
        metrics: [{ id: "revenue", comparisons: ["mom", "yoy", "ytd"] }],
      },
      mappingRules: rules,
      dashboardSpec: null,
      materiality: { pct: "0.05" },
      sourceFingerprints: setupPrepared.fingerprints,
    };
    const setupDone = await completeJob(pool(), wrapper, {
      accountId,
      jobId: setup.jobId,
      snapshot: setupOut.snapshot,
      blueprint,
      output: {
        fileName: setupOut.rendered.fileName,
        bytes: Buffer.from(await setupOut.rendered.workbook.xlsx.writeBuffer()),
      },
      outputStore,
    });
    const setupPrice = (
      await priceFor(pool(), {
        actionKey: "company_setup",
        tier: "professional",
        delivery: "instant",
      })
    ).credits;
    expect(setupDone).toMatchObject({
      captured: setupPrice,
      snapshotVersion: 1,
      blueprintVersion: 1,
    });
    expect(outputStore.files.size).toBe(1);

    // ---------------- Refresh ----------------
    const refreshPrepared = await prepare([tbFile("2026-05")], redactor);
    const refresh = await createJob(pool(), {
      accountId,
      companyId,
      type: "monthly_refresh",
      tier: "professional",
      delivery: "instant",
      idempotencyKey: randomUUID(),
      size: refreshPrepared.size,
      sourceFingerprints: refreshPrepared.fingerprints,
    });
    // Same structure as the blueprint: no restructure price.
    expect(refresh.type).toBe("monthly_refresh");
    expect(refresh.drift?.beyondThreshold).toBe(false);
    await confirmJob(pool(), { accountId, jobId: refresh.jobId });
    for (const s of ["preflight", "profiling", "classifying", "mapping"] as const)
      await advanceJob(pool(), { accountId, jobId: refresh.jobId, to: s });

    const bp = await latestBlueprint(pool(), wrapper, { accountId, companyId });
    const storedRules = mappingRulesSchema.parse(bp?.parts.mappingRules);
    const previous = new Map(storedRules.rules.map((r) => [r.ledgerKey, r.head]));
    const refreshMap = mapStep(refreshPrepared, {
      companyRules: storedRules.rules,
      accountRules: [],
      library: GLOBAL_LIBRARY_SEED,
      fuzzyThreshold: "0.85",
      previous,
      displayName: display,
    });
    expect(refreshMap.unmatched).toEqual([]);
    expect(refreshMap.mappings.every((m) => m.source === "company_rule")).toBe(true);
    // Nothing new or changed: review is skipped (the job moves straight to computing).
    expect(refreshMap.reviewRows).toEqual([]);
    await advanceJob(pool(), { accountId, jobId: refresh.jobId, to: "computing" });

    const stored = await latestSnapshot(pool(), wrapper, {
      accountId,
      companyId,
      period: "2026-04",
    });
    const prior: PriorBalance[] = stored?.ledgerBalances ?? [];
    const closings = new Map(
      prior
        .filter((b) => b.period === "2026-04")
        .map((b) => [b.ledgerKey, BigInt(b.closing)]),
    );
    const refreshOut = await computeAndRender(conn, refreshPrepared, {
      mappings: refreshMap.mappings,
      prior,
      fyStartMonth: 4,
      period: "2026-05" as PeriodId,
      template: MONTHLY_FINANCIAL_MIS,
      companyName: "Synthetic Hardware Traders",
      tierLabel: "Professional",
      snapshotVersion: 1,
      generatedAt: new Date(),
      displayName: display,
      ageingBuckets: VALIDATION.ageingBuckets,
      validation: (cube) =>
        validate(cube, refreshPrepared, {
          config: VALIDATION,
          unmappedAccepted: false,
          expected: { from: "2026-05" as PeriodId, to: "2026-05" as PeriodId },
          previousSnapshot: { period: "2026-04" as PeriodId, closings },
          netProfitStatements: [],
        }),
    });
    expect(gateOutcome(refreshOut.checks)).toEqual({ ok: true });
    expect(refreshOut.checks.find((c) => c.id === "V7")?.status).toBe("pass");
    expect(refreshOut.v11.status).toBe("pass");
    // Comparatives come from the stored snapshot: May's YoY and MoM are real numbers.
    const may = refreshOut.metrics.find(
      (m) => m.metricId === "revenue.yoy_abs" && m.period === "2026-05",
    );
    expect(may?.value).not.toBeNull();

    await advanceJob(pool(), { accountId, jobId: refresh.jobId, to: "validating" });
    await advanceJob(pool(), { accountId, jobId: refresh.jobId, to: "rendering" });
    const refreshDone = await completeJob(pool(), wrapper, {
      accountId,
      jobId: refresh.jobId,
      snapshot: refreshOut.snapshot,
      blueprint: null,
      output: {
        fileName: refreshOut.rendered.fileName,
        bytes: Buffer.from(await refreshOut.rendered.workbook.xlsx.writeBuffer()),
      },
      outputStore,
    });
    const refreshPrice = (
      await priceFor(pool(), {
        actionKey: "monthly_refresh",
        tier: "professional",
        delivery: "instant",
      })
    ).credits;
    expect(refreshDone).toMatchObject({
      captured: refreshPrice,
      snapshotVersion: 1,
      blueprintVersion: null,
    });

    // ---------------- The acceptance assertions ----------------
    expect(await aiCalls(setup.jobId)).toBe(0);
    expect(await aiCalls(refresh.jobId)).toBe(0);
    expect(await wallet(pool(), accountId)).toEqual({
      balance: 20_000n - setupPrice - refreshPrice,
      held: 0n,
    });
    const company = await pool().query<{
      memory_fee_anchor_date: string | null;
      first_setup_at: Date | null;
    }>(
      `select memory_fee_anchor_date::text as memory_fee_anchor_date, first_setup_at from companies where id = $1`,
      [companyId],
    );
    expect(company.rows[0]?.first_setup_at).not.toBeNull();
    expect(company.rows[0]?.memory_fee_anchor_date).not.toBeNull();
    // The stored snapshot carries tokens (normalised inside ledger keys), never party names.
    const refreshSnapshot = await latestSnapshot(pool(), wrapper, {
      accountId,
      companyId,
      period: "2026-05",
    });
    expect(JSON.stringify(refreshSnapshot?.ledgerBalances)).not.toMatch(
      /northwind|bluegate|crestline/iu,
    );
    expect(JSON.stringify(refreshSnapshot?.ledgerBalances)).toMatch(
      /party [0-9a-f]{12}/u,
    );
  });
});
