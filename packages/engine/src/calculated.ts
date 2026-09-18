/**
 * Calculated metrics (ADR 0046): a figure a customer asks the chat for that the catalog does not
 * hold — "employee cost as a share of revenue", "revenue per day". The model proposes the
 * **formula**, as data; this module computes the **number**, exactly, from the stored metric
 * values. Locked decision 7 holds: no figure on any surface was written by a model.
 *
 * A formula is a small tree of add, subtract, multiply and divide over stored metrics and
 * constants. It is evaluated in exact rational arithmetic (bigint numerator and denominator) on
 * the stored values as they are — money in paise, everything else as its decimal value — and
 * rounded once, half-even, at the end: to whole paise for money, to the store's six places
 * otherwise. Division by zero and missing data are explicit nulls with a reason, never 0.
 *
 * Every value carries its formula in words and the metric values it read, so the lineage panel
 * opens on a calculated figure exactly as it does on a built-in one. Month-on-month and
 * year-on-year changes are emitted under the same `.mom_abs` / `.mom_pct` / `.yoy_abs` /
 * `.yoy_pct` ids and rules as the engine's own (percent change for money only).
 */

import { divideRounded } from "@magicmis/core/money";
import { addMonths, type PeriodId } from "@magicmis/core/time";
import { z } from "zod";

import {
  DECIMAL_SCALE,
  none,
  num,
  parseScaled,
  toValue,
  type MetricInput,
  type MetricValue,
  type Num,
  type NullReason,
  type Unit,
} from "./values";

export const CALCULATED_ID = /^calc_[a-z_]{1,50}$/u;
/** A stored metric a formula may read: a catalog id, with or without a comparison suffix. */
const STORED_ID = /^[a-z_]{1,60}(\.[a-z_]{1,20})?$/u;
const MAX_NODES = 40;

export type CalcExpr =
  | { readonly metric: string }
  | { readonly const: string }
  | {
      readonly op: "add" | "sub" | "mul" | "div";
      // Mutable on purpose: a spec holding formulas must stay assignable to plain JSON.
      readonly args: [CalcExpr, CalcExpr];
    };

export const calcExprSchema: z.ZodType<CalcExpr> = z.lazy(() =>
  z.union([
    z
      .object({
        metric: z
          .string()
          .regex(STORED_ID)
          .refine((id) => !id.startsWith("calc_"), {
            message: "a formula reads stored metrics, not other formulas",
          }),
      })
      .strict(),
    z.object({ const: z.string().regex(/^-?\d{1,12}(\.\d{1,6})?$/u) }).strict(),
    z
      .object({
        op: z.enum(["add", "sub", "mul", "div"]),
        args: z.tuple([calcExprSchema, calcExprSchema]),
      })
      .strict(),
  ]),
);

const nodes = (e: CalcExpr): number =>
  "op" in e ? 1 + nodes(e.args[0]) + nodes(e.args[1]) : 1;

export const calculatedMetricSchema = z
  .object({
    id: z.string().regex(CALCULATED_ID),
    label: z.string().min(1).max(80),
    /** How the result is rounded and shown. `money` is in the company's currency. */
    unit: z.enum(["money", "percent", "ratio", "days"]),
    expr: calcExprSchema,
  })
  .strict()
  .refine((m) => nodes(m.expr) <= MAX_NODES, { message: "the formula is too long" })
  .refine((m) => metricsIn(m.expr).length > 0, {
    message: "a formula must read at least one metric",
  });
export type CalculatedMetric = z.infer<typeof calculatedMetricSchema>;

/** The stored metric ids a formula reads, in order of first appearance. */
export function metricsIn(e: CalcExpr): string[] {
  const out: string[] = [];
  const walk = (x: CalcExpr) => {
    if ("metric" in x) {
      if (!out.includes(x.metric)) out.push(x.metric);
    } else if ("op" in x) {
      walk(x.args[0]);
      walk(x.args[1]);
    }
  };
  walk(e);
  return out;
}

const SIGN = { add: "+", sub: "−", mul: "×", div: "÷" } as const;

/** The formula in words, for the lineage panel. */
export function formulaText(e: CalcExpr, label: (metricId: string) => string): string {
  const show = (x: CalcExpr, nested: boolean): string => {
    if ("metric" in x) return label(x.metric);
    if ("const" in x) return x.const;
    const text = `${show(x.args[0], true)} ${SIGN[x.op]} ${show(x.args[1], true)}`;
    return nested ? `(${text})` : text;
  };
  return show(e, false);
}

// --- exact rationals -------------------------------------------------------------------------

interface Q {
  readonly n: bigint;
  /** Always positive. */
  readonly d: bigint;
}
type QResult =
  | { readonly ok: true; readonly q: Q }
  | { readonly ok: false; readonly reason: NullReason };

const abs = (x: bigint) => (x < 0n ? -x : x);
function gcd(a: bigint, b: bigint): bigint {
  let x = abs(a);
  let y = abs(b);
  while (y !== 0n) [x, y] = [y, x % y];
  return x === 0n ? 1n : x;
}
function q(n: bigint, d: bigint): Q {
  const g = gcd(n, d);
  const sign = d < 0n ? -1n : 1n;
  return { n: (sign * n) / g, d: (sign * d) / g };
}

const SCALE = 10n ** BigInt(DECIMAL_SCALE);

function constant(text: string): Q {
  const [whole = "0", frac = ""] = text.replace("-", "").split(".");
  const n = BigInt(`${whole}${frac}`);
  return q(text.startsWith("-") ? -n : n, 10n ** BigInt(frac.length));
}

function stored(v: MetricValue | undefined): QResult {
  if (v === undefined) return { ok: false, reason: "missing_data" };
  if (v.value === null) return { ok: false, reason: v.nullReason ?? "missing_data" };
  return v.unit === "paise" || v.unit === "count"
    ? { ok: true, q: q(BigInt(v.value), 1n) }
    : { ok: true, q: q(parseScaled(v.value), SCALE) };
}

function evaluate(e: CalcExpr, read: (metricId: string) => QResult): QResult {
  if ("metric" in e) return read(e.metric);
  if ("const" in e) return { ok: true, q: constant(e.const) };
  const a = evaluate(e.args[0], read);
  if (!a.ok) return a;
  const b = evaluate(e.args[1], read);
  if (!b.ok) return b;
  const [x, y] = [a.q, b.q];
  switch (e.op) {
    case "add":
      return { ok: true, q: q(x.n * y.d + y.n * x.d, x.d * y.d) };
    case "sub":
      return { ok: true, q: q(x.n * y.d - y.n * x.d, x.d * y.d) };
    case "mul":
      return { ok: true, q: q(x.n * y.n, x.d * y.d) };
    case "div":
      return y.n === 0n
        ? { ok: false, reason: "zero_denominator" }
        : { ok: true, q: q(x.n * y.d, x.d * y.n) };
  }
}

const ENGINE_UNIT: Record<CalculatedMetric["unit"], Unit> = {
  money: "paise",
  percent: "percent",
  ratio: "ratio",
  days: "days",
};

/** Rounded once, half-even: whole paise for money, six places otherwise. */
function rounded(r: QResult, unit: Unit): Num {
  if (!r.ok) return none(r.reason);
  return num(
    unit === "paise"
      ? divideRounded(r.q.n, r.q.d, "half_even")
      : divideRounded(r.q.n * SCALE, r.q.d, "half_even"),
  );
}

/**
 * Is this formula a fact about the company, or a number somebody chose? (ADR 0046)
 *
 * Checking each constant on its own is not enough: `365 × 12 × 100` is three permitted constants
 * and one invented figure, and `(revenue − revenue) + 365` reads a metric and ignores it. So, for
 * a formula someone proposes:
 *
 * - **No arithmetic between constants.** A part of the formula that reads no metric must be a
 *   single constant, which the caller then holds to its own rule (the customer's, or structural).
 * - **The figure must move when the books move.** The formula is evaluated, exactly and with its
 *   own rounding, on three unrelated sets of made-up metric values. If what would be displayed is
 *   the same each time, or is never a number, it does not depend on the company's figures — however
 *   it was dressed — and it is refused.
 *
 * This is a rule for **proposals**, not part of the schema: a saved dashboard is read strictly
 * (ADR 0045), and tightening this later must never make a company's saved formulas unreadable.
 */
export function formulaProblems(m: CalculatedMetric): string[] {
  const problems: string[] = [];
  const readsMetric = (e: CalcExpr): boolean =>
    "metric" in e || ("op" in e && (readsMetric(e.args[0]) || readsMetric(e.args[1])));
  const walk = (e: CalcExpr) => {
    if (!("op" in e)) return;
    if (!readsMetric(e))
      problems.push(
        `${m.id}: works a number out of constants alone (${formulaText(e, (id) => id)})`,
      );
    else {
      walk(e.args[0]);
      walk(e.args[1]);
    }
  };
  walk(m.expr);

  const reads = metricsIn(m.expr);
  const unit = ENGINE_UNIT[m.unit];
  const shown = [
    [3n, 1_000_003n],
    [11n, 7_000_121n],
    [2n, 13_000_027n],
  ].map(([offset = 0n, scale = 1n]) => {
    const r = rounded(
      evaluate(m.expr, (id) => ({
        ok: true,
        q: q((BigInt(reads.indexOf(id)) + offset) * scale, 1n),
      })),
      unit,
    );
    return r.ok ? r.v.toString() : "none";
  });
  if (shown.every((v) => v === shown[0]))
    problems.push(`${m.id}: its result does not depend on the company's figures`);
  return problems;
}

/**
 * The values of every calculated metric for every month in the store, with their month-on-month
 * and year-on-year changes. Pure: the same store and formulas always give the same strings.
 */
export function evaluateCalculated(
  metrics: readonly CalculatedMetric[],
  store: readonly MetricValue[],
  label: (metricId: string) => string,
): MetricValue[] {
  if (metrics.length === 0) return [];
  const totals = new Map<string, MetricValue>();
  for (const v of store)
    if (Object.keys(v.dims).length === 0) totals.set(`${v.metricId}@${v.period}`, v);
  const periods = [...new Set(store.map((v) => v.period))].sort();
  const known = new Set<string>(periods);
  const out: MetricValue[] = [];

  for (const m of metrics) {
    const unit = ENGINE_UNIT[m.unit];
    const reads = metricsIn(m.expr);
    const formula = `${m.label} = ${formulaText(m.expr, label)}`;
    const at = (period: PeriodId): Num =>
      known.has(period)
        ? rounded(
            evaluate(m.expr, (id) => stored(totals.get(`${id}@${period}`))),
            unit,
          )
        : none("no_prior_period");

    for (const period of periods) {
      const base = at(period);
      out.push({
        metricId: m.id,
        period,
        dims: {},
        ...toValue(base, unit),
        unit,
        formula,
        inputs: reads.map((metricId) => ({ kind: "metric", metricId, period })),
      });

      const change = (other: PeriodId, suffix: "mom" | "yoy", words: string) => {
        const prior = at(other);
        const inputs: MetricInput[] = [
          { kind: "metric", metricId: m.id, period },
          { kind: "metric", metricId: m.id, period: other },
        ];
        const diff: Num = !base.ok ? base : !prior.ok ? prior : num(base.v - prior.v);
        out.push({
          metricId: `${m.id}.${suffix}_abs`,
          period,
          dims: {},
          ...toValue(diff, unit),
          unit,
          formula: `Change = current − ${words}`,
          inputs,
        });
        // As in the engine: a percent change is stated for money only. A change in a
        // percentage is already in points, and a percent of a percent misleads.
        if (unit !== "paise") return;
        const pct: Num = !diff.ok
          ? diff
          : !prior.ok
            ? prior
            : prior.v === 0n
              ? none("zero_denominator")
              : num(divideRounded(diff.v * 100n * SCALE, abs(prior.v), "half_even"));
        out.push({
          metricId: `${m.id}.${suffix}_pct`,
          period,
          dims: {},
          ...toValue(pct, "percent"),
          unit: "percent",
          formula: "Change % = change ÷ |prior| × 100",
          inputs,
        });
      };
      change(addMonths(period, -1), "mom", "previous month");
      change(addMonths(period, -12), "yoy", "same month last year");
    }
  }
  return out;
}
