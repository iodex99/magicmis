/**
 * Metric values (SPEC §20): money in integer paise, ratios, percentages and days as exact decimal
 * strings at a fixed scale, rounded half-even only when a division cannot be exact. Division by
 * zero and missing data are explicit nulls with a reason code, never 0.
 */

import { divideRounded } from "@magicmis/core/money";
import type { PeriodId } from "@magicmis/core/time";

export type Unit = "paise" | "percent" | "ratio" | "days" | "count";
export type NullReason = "zero_denominator" | "missing_data" | "no_prior_period";

/** Scale for non-money values. */
export const DECIMAL_SCALE = 6;
const SCALE = 10n ** BigInt(DECIMAL_SCALE);

export type MetricInput =
  | { readonly kind: "metric"; readonly metricId: string; readonly period: PeriodId }
  | {
      readonly kind: "head";
      readonly head: string;
      readonly period: PeriodId;
      readonly field: "movement" | "closing";
      readonly ledgers: number;
    }
  | {
      readonly kind: "source";
      readonly description: string;
      readonly fileId: string;
      readonly sheet: string;
      readonly column: string;
      readonly filter: string;
      readonly rows: number;
    };

export interface MetricValue {
  readonly metricId: string;
  readonly period: PeriodId;
  readonly dims: Readonly<Record<string, string>>;
  /** Integer string for paise and count; fixed-scale decimal string otherwise. */
  readonly value: string | null;
  readonly nullReason: NullReason | null;
  readonly unit: Unit;
  readonly formula: string;
  readonly inputs: readonly MetricInput[];
}

/** An intermediate: scaled integer (paise, or value × 10^6 for decimals), or a null reason. */
export type Num =
  | { readonly ok: true; readonly v: bigint }
  | { readonly ok: false; readonly reason: NullReason };

export const num = (v: bigint): Num => ({ ok: true, v });
export const none = (reason: NullReason): Num => ({ ok: false, reason });

export function lift2(a: Num, b: Num, f: (x: bigint, y: bigint) => Num): Num {
  if (!a.ok) return a;
  if (!b.ok) return b;
  return f(a.v, b.v);
}

export const add = (a: Num, b: Num): Num => lift2(a, b, (x, y) => num(x + y));
export const sub = (a: Num, b: Num): Num => lift2(a, b, (x, y) => num(x - y));

/** (a ÷ b) × multiplier at DECIMAL_SCALE, half-even. Both inputs share a unit (e.g. paise). */
export function divide(a: Num, b: Num, multiplier = 1n): Num {
  return lift2(a, b, (x, y) =>
    y === 0n
      ? none("zero_denominator")
      : num(divideRounded(x * multiplier * SCALE, y, "half_even")),
  );
}

export function formatScaled(v: bigint): string {
  const neg = v < 0n;
  const digits = (neg ? -v : v).toString().padStart(DECIMAL_SCALE + 1, "0");
  const whole = digits.slice(0, -DECIMAL_SCALE);
  const frac = digits.slice(-DECIMAL_SCALE);
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

export function parseScaled(s: string): bigint {
  const m = /^(-)?(\d+)\.(\d{6})$/u.exec(s);
  if (m === null) throw new RangeError(`not a scaled decimal: ${s}`);
  const v = BigInt(`${m[2] ?? "0"}${m[3] ?? ""}`);
  return m[1] === "-" ? -v : v;
}

export function toValue(
  n: Num,
  unit: Unit,
): { value: string | null; nullReason: NullReason | null } {
  if (!n.ok) return { value: null, nullReason: n.reason };
  return {
    value: unit === "paise" || unit === "count" ? n.v.toString() : formatScaled(n.v),
    nullReason: null,
  };
}
