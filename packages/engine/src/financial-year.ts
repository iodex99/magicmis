/**
 * Which month the supplied exports run their financial year from (ADR 0035).
 *
 * This matters because it is invisible until the figures are wrong. Tally-style exports carry
 * profit-and-loss ledgers as **cumulative** balances that reset to zero at the start of the
 * source system's year; the engine turns those into a month's movement by subtracting the
 * previous month's closing *within the same year* (`compute.ts`). It takes the year boundary
 * from the company's `fyStartMonth`. When the company is set to a different year from the files
 * — an Indian April–March export loaded into a company set to January — the reset month is read
 * as an ordinary month, and that month's revenue comes out as the whole year's takings with a
 * minus sign. Everything else looks fine, which is what makes it worth detecting.
 *
 * The signal is the reset itself: the total of the P&L closings collapses in one month and then
 * climbs again. Where the exports are not cumulative at all (each month standing alone) there is
 * no reset to find and no problem to report, so this returns null.
 */

import { periodParts, type PeriodId } from "@magicmis/core/time";

import type { LedgerFact } from "./facts";

/** Below this, a series is not cumulative and the question does not arise. */
const CLIMBING = 0.6;
/** Fewer months than this cannot show a reset and a continuation. */
const MIN_MONTHS = 4;

const monthsBetween = (a: PeriodId, b: PeriodId): number => {
  const from = periodParts(a);
  const to = periodParts(b);
  return (to.year - from.year) * 12 + (to.month - from.month);
};

export interface SourceYear {
  /** 1–12: the month the exports start their year in. */
  readonly startMonth: number;
  /** How many year boundaries the files actually show. */
  readonly resets: number;
}

/**
 * The month the exports' financial year starts in, or null when the files cannot say.
 *
 * `isProfitAndLoss` decides which ledgers carry cumulative balances; the caller supplies it
 * because that classification belongs to the chart of accounts (`primaryOf` in `@magicmis/tally`),
 * not to this file.
 */
export function detectSourceFinancialYear(
  facts: readonly LedgerFact[],
  isProfitAndLoss: (fact: LedgerFact) => boolean,
): SourceYear | null {
  const totals = new Map<PeriodId, bigint>();
  for (const f of facts) {
    if (!isProfitAndLoss(f)) continue;
    const abs = f.closing < 0n ? -f.closing : f.closing;
    totals.set(f.period, (totals.get(f.period) ?? 0n) + abs);
  }
  const periods = [...totals.keys()].sort();
  if (periods.length < MIN_MONTHS) return null;

  let climbs = 0;
  let steps = 0;
  const resetMonths: number[] = [];
  for (let i = 1; i < periods.length; i += 1) {
    const previous = periods[i - 1];
    const current = periods[i];
    if (previous === undefined || current === undefined) continue;
    // Only consecutive months can show a reset; a gap in the months says nothing.
    if (monthsBetween(previous, current) !== 1) continue;
    const before = totals.get(previous) ?? 0n;
    const after = totals.get(current) ?? 0n;
    if (before === 0n) continue;
    steps += 1;
    if (after >= before) climbs += 1;
    // A collapse to under half the running total is a reset, not a quiet month. Integer
    // arithmetic only (SPEC §4), so it is written as a multiplication.
    if (after * 2n < before) resetMonths.push(periodParts(current).month);
  }
  if (steps === 0 || resetMonths.length === 0) return null;
  // A cumulative series climbs between its resets. One that mostly falls is a monthly export,
  // where a lower month is just a quieter month and means nothing about the year.
  const climbing = (climbs + resetMonths.length) * 10 >= steps * CLIMBING * 10;
  if (!climbing) return null;

  const counts = new Map<number, number>();
  for (const m of resetMonths) counts.set(m, (counts.get(m) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const best = ranked[0];
  const runnerUp = ranked[1];
  if (best === undefined) return null;
  // Two different months resetting equally often is noise, not a year.
  if (runnerUp !== undefined && runnerUp[1] === best[1]) return null;
  return { startMonth: best[0], resets: best[1] };
}
