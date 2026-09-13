import type { PeriodId } from "@magicmis/core/time";
import { buildFixtureSet } from "@magicmis/fixtures";
import { detectHeader } from "@magicmis/ingest";
import { parseBills, parsePaySheet } from "@magicmis/tally";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openTestDuck } from "../../ingest/test/duck";
import { ageing, payroll, topContributors } from "../src/analysis";
import { computeCube, ENGINE_VERSION } from "../src/compute";
import { computeMetricStore } from "../src/metrics";
import { recipeSchema } from "../src/recipe";
import { parseSnapshotUpload, SnapshotTooLarge } from "../src/snapshot";
import { buildStore, lineage } from "../src/store";
import { divide, num } from "../src/values";
import { at, gridOf, mapFacts, parseTb } from "./pipeline";

let duck: Awaited<ReturnType<typeof openTestDuck>> | undefined;
beforeAll(async () => {
  duck = await openTestDuck();
});
afterAll(() => {
  duck?.close();
});

const set = buildFixtureSet({ companies: ["trading"], months: 3 });
const tbs = set.files
  .filter((f) => f.report === "trial_balance" && f.variant === "clean")
  .sort((a, b) => a.period.to.localeCompare(b.period.to));

describe("metric store and lineage", () => {
  it("walks from a derived metric down to source rows, with no gaps", async () => {
    if (duck === undefined) throw new Error("duck not open");
    const facts = tbs.flatMap((f) => parseTb(f).facts);
    const { mappings } = mapFacts(facts);
    const cube = await computeCube(duck, { facts, mappings, fyStartMonth: 4 });
    const values = computeMetricStore(cube, [
      { id: "revenue", comparisons: ["mom", "ytd"] },
      { id: "direct_costs", comparisons: [] },
      { id: "gross_profit", comparisons: [] },
      { id: "gross_margin_pct", comparisons: ["ytd"] },
    ]);
    const store = buildStore(values, new Date("2026-09-13T00:00:00Z"));
    expect(store.engineVersion).toBe(ENGINE_VERSION);
    const tree = lineage(store, "gross_margin_pct", "2025-05" as PeriodId, {
      facts,
      mappings,
    });
    expect(tree).toMatchObject({
      kind: "metric",
      metricId: "gross_margin_pct",
      unit: "percent",
    });
    const gp = tree?.kind === "metric" ? tree.children[0] : undefined;
    expect(gp).toMatchObject({ kind: "metric", metricId: "gross_profit" });
    const revenue = gp?.kind === "metric" ? gp.children[0] : undefined;
    const head = revenue?.kind === "metric" ? revenue.children[0] : undefined;
    expect(head).toMatchObject({ kind: "head", head: "REV", field: "movement" });
    expect(head?.kind === "head" ? head.sources.length : 0).toBeGreaterThan(0);
    expect(head?.kind === "head" ? head.sources[0]?.fileId : "").toContain(
      "trial_balance_2025-05",
    );
    expect(() => buildStore([...values, at(values, 0)], new Date())).toThrow(
      /duplicate/u,
    );
  });

  it("division by zero is an explicit null, never 0", () => {
    expect(divide(num(5n), num(0n))).toEqual({ ok: false, reason: "zero_denominator" });
  });
});

describe("analysis", () => {
  it("ranks contributors to change by absolute amount", async () => {
    if (duck === undefined) throw new Error("duck not open");
    const cube = await computeCube(duck, {
      facts: parseTb(at(tbs, 0)).facts,
      mappings: [],
      fyStartMonth: 4,
      dimensions: [
        {
          period: "2025-04" as PeriodId,
          dimension: "party",
          value: "PARTY_a",
          head: "REV",
          amount: 100n,
        },
        {
          period: "2025-03" as PeriodId,
          dimension: "party",
          value: "PARTY_a",
          head: "REV",
          amount: 150n,
        },
        {
          period: "2025-04" as PeriodId,
          dimension: "party",
          value: "PARTY_b",
          head: "REV",
          amount: 400n,
        },
        {
          period: "2025-03" as PeriodId,
          dimension: "party",
          value: "PARTY_b",
          head: "REV",
          amount: 100n,
        },
      ],
    });
    const top = topContributors(cube, {
      dimension: "party",
      head: "REV",
      period: "2025-04" as PeriodId,
      previous: "2025-03" as PeriodId,
    });
    expect(top.map((t) => [t.value, t.change])).toEqual([
      ["PARTY_b", 300n],
      ["PARTY_a", -50n],
    ]);
    expect(top[0]?.shareOfChangePct).toBe("120.000000");
  });

  it("ages receivable bills into configured buckets and sums payroll", () => {
    const bills = set.files.find(
      (f) => f.report === "bills_receivable" && f.variant === "clean",
    );
    const pay = set.files.find((f) => f.report === "pay_sheet" && f.variant === "clean");
    if (bills === undefined || pay === undefined) throw new Error("fixtures missing");
    const bg = gridOf(bills);
    const bh = detectHeader(bg);
    if (bh === null) throw new Error("no header");
    const parsed = parseBills(bg, bh);
    const asAt = parsed.asAt ?? bills.period.to;
    const buckets = [
      [0, 30],
      [31, 60],
      [61, 90],
      [91, 180],
      [181, null],
    ] as const;
    const aged = ageing(parsed.bills, {
      asAt,
      period: bills.period.to.slice(0, 7) as PeriodId,
      buckets,
      side: "receivable",
      fileId: bills.name,
      sheet: bg.name,
    });
    const total = aged.reduce((s, v) => s + BigInt(v.value ?? "0"), 0n);
    expect(bills.truth.kind).toBe("bills");
    if (bills.truth.kind === "bills")
      expect(total.toString()).toBe(bills.truth.pending.replace("-", ""));
    expect(aged.map((v) => v.dims["bucket"])).toEqual([
      "0-30",
      "31-60",
      "61-90",
      "91-180",
      "181+",
      "undated",
    ]);

    const pg = gridOf(pay);
    const ph = detectHeader(pg);
    if (ph === null) throw new Error("no header");
    const lines = parsePaySheet(pg, ph).lines;
    const values = payroll(lines, {
      period: pay.period.to.slice(0, 7) as PeriodId,
      fileId: pay.name,
      sheet: pg.name,
    });
    if (pay.truth.kind === "pay")
      expect(values.find((v) => v.metricId === "headcount")?.value).toBe(
        pay.truth.employees.toString(),
      );
    expect(values.some((v) => v.metricId === "payroll_cost")).toBe(true);
  });
});

describe("recipe and snapshot schemas", () => {
  it("accepts declarative recipes only", () => {
    const recipe = {
      schemaVersion: 1,
      sources: [
        {
          id: "tb",
          role: "trial_balance",
          sheetSignature: "sig",
          columns: { particulars: "Particulars", closing: "Closing Balance" },
          sign: "split_columns",
        },
      ],
      mappingRulesVersion: 1,
      period: { fyStartMonth: 4, granularity: "month" },
      metrics: [{ id: "revenue", comparisons: ["mom"] }],
    };
    expect(recipeSchema.parse(recipe).filters).toEqual([]);
    expect(() => recipeSchema.parse({ ...recipe, sql: "select 1" })).not.toThrow();
    expect(recipeSchema.parse({ ...recipe, sql: "select 1" })).not.toHaveProperty("sql");
    expect(() =>
      recipeSchema.parse({ ...recipe, metrics: [{ id: "drop table" }] }),
    ).toThrow();
  });

  it("caps snapshot size and validates shape", () => {
    const payload = {
      schemaVersion: 1,
      period: "2025-04",
      engineVersion: ENGINE_VERSION,
      sourceFingerprint: "fp",
      ledgerBalances: [
        {
          ledgerKey: "sundry debtors > party_abc",
          head: "CA_RECEIVABLES",
          period: "2025-04",
          closing: "100",
          movement: null,
        },
      ],
      metricStore: {
        engineVersion: ENGINE_VERSION,
        computedAt: "2026-09-13T00:00:00.000Z",
        values: [],
      },
      validationResults: [
        {
          id: "V1",
          status: "pass",
          severity: "blocking",
          failureClass: "data_fault",
          amounts: {},
        },
      ],
    };
    const json = JSON.stringify(payload);
    expect(parseSnapshotUpload(json, 5_000_000).period).toBe("2025-04");
    expect(() => parseSnapshotUpload(json, 10)).toThrow(SnapshotTooLarge);
    expect(() =>
      parseSnapshotUpload(JSON.stringify({ ...payload, period: "April" }), 5_000_000),
    ).toThrow();
  });
});
