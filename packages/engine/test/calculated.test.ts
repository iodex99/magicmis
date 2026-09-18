/**
 * ADR 0046: a formula the chat proposes is data; the number is computed here, exactly. Property
 * tests because this is arithmetic on money.
 */

import type { PeriodId } from "@magicmis/core/time";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  calculatedMetricSchema,
  evaluateCalculated,
  formulaProblems,
  formulaText,
  metricsIn,
  type CalcExpr,
  type CalculatedMetric,
} from "../src/calculated";
import type { MetricValue, Unit } from "../src/values";

const P = (s: string) => s as PeriodId;
const value = (
  metricId: string,
  period: string,
  v: string | null,
  unit: Unit = "paise",
): MetricValue => ({
  metricId,
  period: P(period),
  dims: {},
  value: v,
  nullReason: v === null ? "missing_data" : null,
  unit,
  formula: "",
  inputs: [],
});
const label = (id: string) =>
  ({ revenue: "Revenue", employee_cost: "Employee cost" })[id] ?? id;
const m = (id: string): CalcExpr => ({ metric: id });
const k = (c: string): CalcExpr => ({ const: c });
const op = (o: "add" | "sub" | "mul" | "div", a: CalcExpr, b: CalcExpr): CalcExpr => ({
  op: o,
  args: [a, b],
});
const calc = (
  unit: CalculatedMetric["unit"],
  expr: CalcExpr,
  id = "calc_test",
): CalculatedMetric => calculatedMetricSchema.parse({ id, label: "Test", unit, expr });
const find = (out: readonly MetricValue[], id: string, period: string) =>
  out.find((v) => v.metricId === id && v.period === period);

describe("a calculated metric", () => {
  const store = [
    value("revenue", "2026-03", "900000000"),
    value("revenue", "2026-04", "1000000000"),
    value("employee_cost", "2026-03", "300000000"),
    value("employee_cost", "2026-04", "250000000"),
    value("gross_margin_pct", "2026-04", "23.500000", "percent"),
  ];

  it("is computed exactly, rounded once, and explains itself", () => {
    const share = calc(
      "percent",
      op("mul", op("div", m("employee_cost"), m("revenue")), k("100")),
    );
    const out = evaluateCalculated([share], store, label);
    expect(find(out, "calc_test", "2026-04")).toMatchObject({
      value: "25.000000",
      unit: "percent",
      nullReason: null,
      formula: "Test = (Employee cost ÷ Revenue) × 100",
      inputs: [
        { kind: "metric", metricId: "employee_cost", period: "2026-04" },
        { kind: "metric", metricId: "revenue", period: "2026-04" },
      ],
    });
    // A third is not exact at any number of places: rounded half-even at six, once.
    expect(find(out, "calc_test", "2026-03")?.value).toBe("33.333333");
  });

  it("keeps money in whole paise, and mixes stored decimals with money exactly", () => {
    const perDay = calc("money", op("div", m("revenue"), k("30")));
    expect(
      find(evaluateCalculated([perDay], store, label), "calc_test", "2026-04"),
    ).toMatchObject({ value: "33333333", unit: "paise" });
    const gross = calc(
      "money",
      op("div", op("mul", m("revenue"), m("gross_margin_pct")), k("100")),
    );
    expect(
      find(evaluateCalculated([gross], store, label), "calc_test", "2026-04")?.value,
    ).toBe("235000000");
  });

  it("says why there is no number instead of showing zero", () => {
    const byZero = calc(
      "ratio",
      op("div", m("revenue"), op("sub", m("revenue"), m("revenue"))),
    );
    const missing = calc(
      "money",
      op("add", m("revenue"), m("other_income")),
      "calc_missing",
    );
    const out = evaluateCalculated([byZero, missing], store, label);
    expect(find(out, "calc_test", "2026-04")).toMatchObject({
      value: null,
      nullReason: "zero_denominator",
    });
    expect(find(out, "calc_missing", "2026-04")).toMatchObject({
      value: null,
      nullReason: "missing_data",
    });
  });

  it("carries month-on-month and year-on-year changes under the engine's own ids and rules", () => {
    const total = calc("money", op("add", m("revenue"), m("employee_cost")));
    const out = evaluateCalculated([total], store, label);
    expect(find(out, "calc_test.mom_abs", "2026-04")?.value).toBe("50000000");
    expect(find(out, "calc_test.mom_pct", "2026-04")).toMatchObject({
      value: "4.166667",
      unit: "percent",
    });
    expect(find(out, "calc_test.mom_abs", "2026-03")).toMatchObject({
      value: null,
      nullReason: "no_prior_period",
    });
    expect(find(out, "calc_test.yoy_abs", "2026-04")?.nullReason).toBe("no_prior_period");
    // A change in a percentage is in points; no percent of a percent.
    const share = calc(
      "percent",
      op("div", m("employee_cost"), m("revenue")),
      "calc_share",
    );
    const pct = evaluateCalculated([share], store, label);
    expect(find(pct, "calc_share.mom_abs", "2026-04")).toBeDefined();
    expect(find(pct, "calc_share.mom_pct", "2026-04")).toBeUndefined();
  });

  it("ignores dimensioned values: a formula reads company totals", () => {
    const dimmed: MetricValue = {
      ...value("revenue", "2026-04", "1"),
      dims: { party: "x" },
    };
    const out = evaluateCalculated(
      [calc("money", m("revenue"))],
      [...store, dimmed],
      label,
    );
    expect(find(out, "calc_test", "2026-04")?.value).toBe("1000000000");
  });
});

describe("the formula schema", () => {
  const parse = (expr: unknown, id = "calc_x") =>
    calculatedMetricSchema.safeParse({ id, label: "X", unit: "money", expr });

  it("accepts only the four operations over stored metrics and plain constants", () => {
    expect(parse(op("add", m("revenue"), k("12.5"))).success).toBe(true);
    expect(parse(m("revenue.mom_abs")).success).toBe(true);
    expect(parse({ op: "pow", args: [m("revenue"), k("2")] }).success).toBe(false);
    expect(parse({ metric: "revenue", extra: 1 }).success).toBe(false);
    expect(parse(k("1e9")).success).toBe(false);
    expect(parse({ metric: "Revenue; drop table" }).success).toBe(false);
    expect(parse(m("revenue"), "revenue").success).toBe(false);
  });

  it("refuses a formula of formulas, one with no metric, and one too long to read", () => {
    expect(parse(m("calc_other")).success).toBe(false);
    expect(parse(op("add", k("1"), k("2"))).success).toBe(false);
    let long: CalcExpr = m("revenue");
    for (let i = 0; i < 25; i += 1) long = op("add", long, k("1"));
    expect(parse(long).success).toBe(false);
  });

  it("names what a formula reads, once each, and writes it in words", () => {
    const e = op("div", op("sub", m("revenue"), m("employee_cost")), m("revenue"));
    expect(metricsIn(e)).toEqual(["revenue", "employee_cost"]);
    expect(formulaText(e, label)).toBe("(Revenue − Employee cost) ÷ Revenue");
  });
});

describe("a formula must be a fact about the company, not a number somebody chose", () => {
  it("accepts what depends on the books", () => {
    for (const expr of [
      op("mul", op("div", m("employee_cost"), m("revenue")), k("100")),
      op("mul", m("revenue"), k("12")),
      op("div", m("revenue"), k("365")),
      op("sub", m("revenue"), m("employee_cost")),
      m("revenue"),
    ])
      expect(formulaProblems(calc("money", expr))).toEqual([]);
  });

  it("refuses a number built out of permitted constants", () => {
    // Three structural constants and one invented figure, hung on a metric multiplied by zero.
    const target = op(
      "add",
      op("mul", m("revenue"), op("sub", k("1"), k("1"))),
      op("mul", op("mul", k("365"), k("12")), k("100")),
    );
    const problems = formulaProblems(calc("money", target));
    expect(problems.join(" ")).toContain("out of constants alone (1 − 1)");
    expect(problems.join(" ")).toContain("out of constants alone ((365 × 12) × 100)");
    expect(problems.join(" ")).toContain("does not depend on the company's figures");
  });

  it("refuses a metric read and then thrown away, with no arithmetic between constants at all", () => {
    expect(
      formulaProblems(
        calc("money", op("add", op("sub", m("revenue"), m("revenue")), k("365"))),
      ),
    ).toEqual(["calc_test: its result does not depend on the company's figures"]);
    expect(
      formulaProblems(
        calc("percent", op("mul", op("div", m("pat"), m("pat")), k("100"))),
      ),
    ).toEqual(["calc_test: its result does not depend on the company's figures"]);
  });

  it("refuses a metric shrunk until the chosen number is all that is displayed", () => {
    let tiny: CalcExpr = m("revenue");
    for (let i = 0; i < 12; i += 1) tiny = op("div", tiny, k("365"));
    expect(
      formulaProblems(calc("money", op("mul", op("add", tiny, k("365")), k("12")))),
    ).toEqual(["calc_test: its result does not depend on the company's figures"]);
  });

  it("refuses what is never a number", () => {
    expect(
      formulaProblems(
        calc("ratio", op("div", m("revenue"), op("sub", m("revenue"), m("revenue")))),
      ),
    ).toEqual(["calc_test: its result does not depend on the company's figures"]);
  });
});

describe("exact arithmetic (properties)", () => {
  const paise = fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n });
  const at = (
    a: bigint,
    b: bigint,
    expr: CalcExpr,
    unit: CalculatedMetric["unit"] = "money",
  ) =>
    find(
      evaluateCalculated(
        [calc(unit, expr)],
        [
          value("revenue", "2026-04", a.toString()),
          value("pat", "2026-04", b.toString()),
        ],
        label,
      ),
      "calc_test",
      "2026-04",
    );

  it("adding then subtracting the same metric gives the first back, to the paisa", () => {
    fc.assert(
      fc.property(paise, paise, (a, b) => {
        const r = at(a, b, op("sub", op("add", m("revenue"), m("pat")), m("pat")));
        expect(r?.value).toBe(a.toString());
      }),
    );
  });

  it("dividing then multiplying by the same non-zero metric loses nothing", () => {
    fc.assert(
      fc.property(
        paise,
        paise.filter((b) => b !== 0n),
        (a, b) => {
          // Floating point, or rounding at the division, would drift here.
          const r = at(a, b, op("mul", op("div", m("revenue"), m("pat")), m("pat")));
          expect(r?.value).toBe(a.toString());
        },
      ),
    );
  });

  it("a share of itself is one hundred percent, and dividing by zero is never a number", () => {
    fc.assert(
      fc.property(
        paise.filter((a) => a !== 0n),
        (a) => {
          const share = op("mul", op("div", m("revenue"), m("revenue")), k("100"));
          expect(at(a, 0n, share, "percent")?.value).toBe("100.000000");
          expect(at(a, 0n, op("div", m("revenue"), m("pat")), "ratio")).toMatchObject({
            value: null,
            nullReason: "zero_denominator",
          });
        },
      ),
    );
  });

  it("is order-independent for addition and multiplication", () => {
    fc.assert(
      fc.property(paise, paise, (a, b) => {
        expect(at(a, b, op("add", m("revenue"), m("pat")))?.value).toBe(
          at(a, b, op("add", m("pat"), m("revenue")))?.value,
        );
        expect(at(a, b, op("mul", m("revenue"), m("pat")), "ratio")?.value).toBe(
          at(a, b, op("mul", m("pat"), m("revenue")), "ratio")?.value,
        );
      }),
    );
  });
});
