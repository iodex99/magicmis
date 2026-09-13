/**
 * SPEC §34 Phase 5 acceptance: fixtures produce correct metrics to the paisa.
 *
 * Every clean monthly trial balance of all three synthetic companies (14 months each) runs through
 * the production path — SheetJS → header detection → Tally parser → facts → mapping cascade →
 * DuckDB-WASM compute → metric library — and each metric is compared with a figure computed
 * independently from the generator's ledger × month ground truth by Tally group.
 */

import { divideRounded } from "@magicmis/core/money";
import { daysInMonth, type PeriodId } from "@magicmis/core/time";
import { buildFixtureSet, type CompanyTruth } from "@magicmis/fixtures";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openTestDuck } from "../../ingest/test/duck";
import { MetricEngine } from "../src/metrics";
import { formatScaled } from "../src/values";
import { cubeFor, mapFacts, parseTb } from "./pipeline";

let duck: Awaited<ReturnType<typeof openTestDuck>> | undefined;
beforeAll(async () => {
  duck = await openTestDuck();
});
afterAll(() => {
  duck?.close();
});

const set = buildFixtureSet();

/** Independent expectations from ground truth, by Tally group placement. */
function expected(truth: CompanyTruth, month: string) {
  const bal = (id: string) => {
    const b = truth.balances[id]?.[month];
    if (b === undefined) throw new Error(`no truth for ${id} ${month}`);
    return { movement: BigInt(b.debit) - BigInt(b.credit), closing: BigInt(b.closing) };
  };
  const sum = (
    pred: (path: readonly string[]) => boolean,
    field: "movement" | "closing",
  ) =>
    truth.ledgers.filter((l) => pred(l.path)).reduce((s, l) => s + bal(l.id)[field], 0n);
  const has = (g: string) => (p: readonly string[]) => p.slice(0, -1).includes(g);
  const isDep = (p: readonly string[]) =>
    p.at(-1) === "Depreciation" && has("Indirect Expenses")(p);

  const revenue = -sum(
    (p) => has("Sales Accounts")(p) || has("Direct Incomes")(p),
    "movement",
  );
  const direct = sum(
    (p) => has("Purchase Accounts")(p) || has("Direct Expenses")(p),
    "movement",
  );
  const employee = sum(has("Employee Costs"), "movement");
  const depreciation = sum(isDep, "movement");
  const opex = sum(
    (p) => has("Indirect Expenses")(p) && !has("Employee Costs")(p) && !isDep(p),
    "movement",
  );
  const otherIncome = -sum(has("Indirect Incomes"), "movement");
  const gp = revenue - direct;
  const ebitda = gp - employee - opex;
  const pbt = ebitda + otherIncome - depreciation;
  const receivables = sum(has("Sundry Debtors"), "closing");
  const payables = -sum(has("Sundry Creditors"), "closing");
  const inventory = sum(has("Stock-in-hand"), "closing");
  // Deposits (Asset) are long-term in the MIS schema even though Tally files them under Current Assets.
  const currentAssets = sum(
    (p) => has("Current Assets")(p) && !has("Deposits (Asset)")(p),
    "closing",
  );
  const currentLiabilities = -sum(
    (p) => has("Current Liabilities")(p) || has("Bank OD A/c")(p),
    "closing",
  );
  return {
    revenue,
    direct,
    gp,
    employee,
    opex,
    otherIncome,
    ebitda,
    depreciation,
    pbt,
    receivables,
    payables,
    inventory,
    currentAssets,
    currentLiabilities,
  };
}

const pct = (a: bigint, b: bigint) =>
  b === 0n ? null : formatScaled(divideRounded(a * 100n * 1_000_000n, b, "half_even"));
const ratio = (a: bigint, b: bigint) =>
  b === 0n ? null : formatScaled(divideRounded(a * 1_000_000n, b, "half_even"));

describe.each(set.truths.map((t) => [t.company, t] as const))("%s", (company, truth) => {
  it("every month's metrics equal ground truth to the paisa", async () => {
    if (duck === undefined) throw new Error("duck not open");
    const files = set.files
      .filter(
        (f) =>
          f.company === company && f.report === "trial_balance" && f.variant === "clean",
      )
      .sort((a, b) => a.period.to.localeCompare(b.period.to));
    expect(files).toHaveLength(14);

    const facts = files.flatMap((f) => parseTb(f).facts);
    const { mappings, unmatched } = mapFacts(facts);
    expect(unmatched).toBe(0);
    const cube = await cubeFor(duck, facts, mappings);
    const engine = new MetricEngine(cube);

    let checked = 0;
    for (const f of files) {
      const month = f.period.to.slice(0, 7) as PeriodId;
      const e = expected(truth, month);
      const get = (id: string) => engine.evaluate(id, month).value;
      const money: [string, bigint][] = [
        ["revenue", e.revenue],
        ["direct_costs", e.direct],
        ["gross_profit", e.gp],
        ["employee_cost", e.employee],
        ["other_opex", e.opex],
        ["other_income", e.otherIncome],
        ["ebitda", e.ebitda],
        ["depreciation", e.depreciation],
        ["finance_cost", 0n],
        ["tax", 0n],
        ["pbt", e.pbt],
        ["pat", e.pbt],
        ["receivables", e.receivables],
        ["payables", e.payables],
        ["inventory", e.inventory],
        ["current_assets", e.currentAssets],
        ["current_liabilities", e.currentLiabilities],
        ["working_capital", e.currentAssets - e.currentLiabilities],
      ];
      for (const [id, value] of money) {
        expect(get(id), `${company} ${month} ${id}`).toBe(value.toString());
        checked += 1;
      }
      const [y, m] = month.split("-").map((x) => Number.parseInt(x, 10));
      const days = BigInt(daysInMonth(y ?? 0, m ?? 0));
      const decimals: [string, string | null][] = [
        ["gross_margin_pct", pct(e.gp, e.revenue)],
        ["ebitda_pct", pct(e.ebitda, e.revenue)],
        ["pat_pct", pct(e.pbt, e.revenue)],
        ["current_ratio", ratio(e.currentAssets, e.currentLiabilities)],
        ["quick_ratio", ratio(e.currentAssets - e.inventory, e.currentLiabilities)],
        [
          "dso",
          e.revenue === 0n
            ? null
            : formatScaled(
                divideRounded(e.receivables * days * 1_000_000n, e.revenue, "half_even"),
              ),
        ],
      ];
      for (const [id, value] of decimals) {
        expect(get(id), `${company} ${month} ${id}`).toBe(value);
        checked += 1;
      }
    }
    expect(checked).toBe(14 * 24);

    // YTD revenue across the FY boundary and MoM against the previous month.
    const [, apr26] = [files[0], files[12]];
    expect(apr26?.period.to.slice(0, 7)).toBe("2026-04");
    const ytd = engine.comparisons("revenue", "2026-05" as PeriodId, ["ytd", "mom"]);
    const may = expected(truth, "2026-05").revenue;
    const apr = expected(truth, "2026-04").revenue;
    expect(ytd.find((v) => v.metricId === "revenue.ytd")?.value).toBe(
      (may + apr).toString(),
    );
    expect(ytd.find((v) => v.metricId === "revenue.mom_abs")?.value).toBe(
      (may - apr).toString(),
    );
    const first = engine.comparisons("revenue", "2025-04" as PeriodId, ["mom", "yoy"]);
    expect(first.find((v) => v.metricId === "revenue.mom_abs")).toMatchObject({
      value: null,
      nullReason: "no_prior_period",
    });
    const yoy = engine.comparisons("revenue", "2026-04" as PeriodId, ["yoy"]);
    expect(yoy.find((v) => v.metricId === "revenue.yoy_abs")?.value).toBe(
      (apr - expected(truth, "2025-04").revenue).toString(),
    );
  });
});

describe("closing-only and messy layouts", () => {
  it.each([
    "messy_level_column",
    "messy_subtotal_rows",
    "messy_suffix",
    "messy_parent_column",
    "messy_wrapped",
    "messy_truncated",
  ])(
    "%s: P&L movement from closings across months equals ground truth",
    async (variant) => {
      if (duck === undefined) throw new Error("duck not open");
      for (const truth of set.truths) {
        const files = set.files
          .filter(
            (f) =>
              f.company === truth.company &&
              f.report === "trial_balance" &&
              f.variant === variant,
          )
          .sort((a, b) => a.period.to.localeCompare(b.period.to));
        expect(files).toHaveLength(3);
        const facts = files.flatMap((f) => parseTb(f).facts);
        const cube = await cubeFor(duck, facts);
        const engine = new MetricEngine(cube);
        for (const f of files) {
          const month = f.period.to.slice(0, 7) as PeriodId;
          const e = expected(truth, month);
          expect(
            engine.evaluate("revenue", month).value,
            `${truth.company} ${variant} ${month} revenue`,
          ).toBe(e.revenue.toString());
          expect(
            engine.evaluate("pbt", month).value,
            `${truth.company} ${variant} ${month} pbt`,
          ).toBe(e.pbt.toString());
          expect(engine.evaluate("receivables", month).value).toBe(
            e.receivables.toString(),
          );
        }
      }
    },
  );
});
