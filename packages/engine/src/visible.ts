/**
 * What a dashboard shows when the customer has unticked some of their files (ADR 0047).
 *
 * Unticking a file hides the months it fed. Hiding a month is not only dropping that month's
 * figures: a change "on last month" computed against a hidden month, or a year-to-date total
 * that includes one, would still be on screen, stating something about data the customer asked
 * not to see and could no longer check. So the rule is about dependence:
 *
 *   **a figure is shown only if no month it was computed from is hidden.**
 *
 * Nothing is recomputed. The stored figures are exact and stay as they are; ticking the file
 * again brings every one of them back. A figure that is left out shows as a dash, never as zero.
 */

import {
  addMonths,
  financialYearOf,
  periodRange,
  type PeriodId,
} from "@magicmis/core/time";

import type { MetricValue } from "./values";

/** Every month a stored figure was computed from, its own included. */
export function monthsBehind(v: MetricValue, fyStartMonth: number): PeriodId[] {
  const months = new Set<PeriodId>([v.period]);
  for (const input of v.inputs) if ("period" in input) months.add(input.period);
  // A year-to-date total names only its end month as an input; it stands on every month of the
  // financial year up to it.
  const suffix = v.metricId.split(".")[1];
  if (suffix === "ytd" || suffix === "ly_ytd") {
    const end = suffix === "ytd" ? v.period : addMonths(v.period, -12);
    for (const p of periodRange(financialYearOf(end, fyStartMonth).start, end))
      months.add(p);
  }
  return [...months];
}

export function visibleValues(
  values: readonly MetricValue[],
  hidden: ReadonlySet<string>,
  fyStartMonth: number,
): MetricValue[] {
  if (hidden.size === 0) return [...values];
  return values.filter((v) => monthsBehind(v, fyStartMonth).every((p) => !hidden.has(p)));
}
