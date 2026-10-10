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
import { head as headDef } from "@magicmis/semantic";

import type { MetricInput, MetricValue } from "./values";

/**
 * Whether a head's movement in `period` was taken against the month before (ADR 0091). It was,
 * always, except a profit-and-loss head in the first month of its financial year, whose movement
 * is that month's closing alone. So hiding February must hide March's revenue too: it is March's
 * closing less February's.
 */
function movesAgainstPrevious(
  input: Extract<MetricInput, { kind: "head" }>,
  fyStartMonth: number,
): boolean {
  if (input.field !== "movement") return false;
  let pnl = false;
  try {
    pnl = headDef(input.head).statement === "pnl";
  } catch {
    // An unknown head: assume the dependence, which can only hide more.
  }
  return !(pnl && financialYearOf(input.period, fyStartMonth).start === input.period);
}

/**
 * Every month a stored figure was computed from, its own included — through the figures it was
 * computed from, when `lookup` can find them: a margin names revenue as its input, and revenue
 * stands on the month before.
 */
export function monthsBehind(
  v: MetricValue,
  fyStartMonth: number,
  lookup?: (metricId: string, period: PeriodId) => MetricValue | undefined,
  seen: Set<string> = new Set(),
): PeriodId[] {
  const months = new Set<PeriodId>([v.period]);
  seen.add(`${v.metricId}@${v.period}`);
  for (const input of v.inputs) {
    if (!("period" in input)) continue;
    months.add(input.period);
    if (input.kind === "head" && movesAgainstPrevious(input, fyStartMonth))
      months.add(addMonths(input.period, -1));
    if (input.kind === "metric" && lookup !== undefined) {
      const key = `${input.metricId}@${input.period}`;
      const behind = seen.has(key) ? undefined : lookup(input.metricId, input.period);
      if (behind !== undefined)
        for (const p of monthsBehind(behind, fyStartMonth, lookup, seen)) months.add(p);
    }
  }
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
  const byKey = new Map<string, MetricValue>();
  for (const v of values)
    if (Object.keys(v.dims).length === 0) byKey.set(`${v.metricId}@${v.period}`, v);
  const lookup = (metricId: string, period: PeriodId) =>
    byKey.get(`${metricId}@${period}`);
  return values.filter((v) =>
    monthsBehind(v, fyStartMonth, lookup).every((p) => !hidden.has(p)),
  );
}
