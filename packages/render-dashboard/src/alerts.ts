/**
 * Alerts on a company's own figures (ADR 0087): "cash below this", "debtor days above that". One
 * rule decides whether one fires, here, so the notice a run sends and the board a reader opens
 * can never disagree. Compared exactly, as the engine stores values: integers for money and
 * counts, six decimal places for everything else — never through a float.
 */

import type { MetricValue } from "@magicmis/engine";

export type AlertComparator = "below" | "above";

export interface AlertRule {
  readonly id: string;
  readonly metricId: string;
  readonly comparator: AlertComparator;
  /** In the metric's own unit: minor units for money, a decimal for a ratio or days. */
  readonly threshold: string;
}

/** A value string at six decimal places, as an integer. */
function scaled(value: string): bigint {
  const negative = value.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const n = BigInt(whole) * 1_000_000n + BigInt(`${fraction}000000`.slice(0, 6));
  return negative ? -n : n;
}

/** The month's value when the alert fires on it; null when it does not, or there is no value. */
export function alertFires(
  rule: AlertRule,
  values: readonly MetricValue[],
  period: string,
): MetricValue | null {
  const v = values.find(
    (x) =>
      x.metricId === rule.metricId &&
      x.period === period &&
      Object.keys(x.dims).length === 0,
  );
  if (v?.value == null) return null;
  const money = v.unit === "paise" || v.unit === "count";
  const value = money ? BigInt(v.value) * 1_000_000n : scaled(v.value);
  const threshold = scaled(rule.threshold);
  const fires = rule.comparator === "below" ? value < threshold : value > threshold;
  return fires ? v : null;
}

/** Every alert that fires on the month. */
export function firedAlerts(
  rules: readonly AlertRule[],
  values: readonly MetricValue[],
  period: string,
): { rule: AlertRule; value: MetricValue }[] {
  return rules.flatMap((rule) => {
    const value = alertFires(rule, values, period);
    return value === null ? [] : [{ rule, value }];
  });
}
