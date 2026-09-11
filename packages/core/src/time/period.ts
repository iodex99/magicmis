/**
 * Monthly periods and the Indian financial year.
 *
 * SPEC §2.14: the financial year runs April to March **by default** and is configurable
 * per company (`companies.fy_start_month`, default 4). Every function here takes the
 * start month as an argument -- SPEC §0.5 forbids hardcoding a business number, and a
 * hardcoded April would quietly break the first company that uses a January year.
 */

import { compareCalendarDates, daysInMonth, type CalendarDate } from "./calendar-date.js";

/** A month, as `YYYY-MM`. Matches `snapshots.period` in SPEC §9. */
export type PeriodId = string & { readonly __brand: "PeriodId" };

const PERIOD_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/u;

export function periodId(year: number, month: number): PeriodId {
  if (!Number.isInteger(year) || year < 1900 || year > 9999) {
    throw new RangeError(`periodId: year ${String(year)} out of range`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`periodId: month ${String(month)} out of range`);
  }
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}` as PeriodId;
}

export function parsePeriodId(input: string): PeriodId | null {
  const m = PERIOD_PATTERN.exec(input);
  if (!m) return null;
  return input as PeriodId;
}

export function periodParts(p: PeriodId): { year: number; month: number } {
  const m = PERIOD_PATTERN.exec(p);
  if (!m) throw new RangeError(`periodParts: ${p} is not a period id`);
  return {
    year: Number.parseInt(m[1] ?? "", 10),
    month: Number.parseInt(m[2] ?? "", 10),
  };
}

export const periodOf = (d: CalendarDate): PeriodId => periodId(d.year, d.month);

/** Months between two periods, signed. `b - a`. */
export function periodDiff(a: PeriodId, b: PeriodId): number {
  const pa = periodParts(a);
  const pb = periodParts(b);
  return (pb.year - pa.year) * 12 + (pb.month - pa.month);
}

export function addMonths(p: PeriodId, months: number): PeriodId {
  const { year, month } = periodParts(p);
  const zeroBased = year * 12 + (month - 1) + months;
  return periodId(Math.floor(zeroBased / 12), (((zeroBased % 12) + 12) % 12) + 1);
}

export const comparePeriods = (a: PeriodId, b: PeriodId): number => periodDiff(b, a);

/** The same month one year earlier -- the comparative every MIS column set needs. */
export const sameMonthLastYear = (p: PeriodId): PeriodId => addMonths(p, -12);

/** Last calendar day of a period. Leap-year aware. */
export function periodEndDate(p: PeriodId): CalendarDate {
  const { year, month } = periodParts(p);
  return { year, month, day: daysInMonth(year, month) };
}

export function periodStartDate(p: PeriodId): CalendarDate {
  const { year, month } = periodParts(p);
  return { year, month, day: 1 };
}

/** Every period from `from` to `to` inclusive. Empty if `to` precedes `from`. */
export function periodRange(from: PeriodId, to: PeriodId): PeriodId[] {
  const count = periodDiff(from, to);
  if (count < 0) return [];
  return Array.from({ length: count + 1 }, (_, i) => addMonths(from, i));
}

// ---------------------------------------------------------------------------
// Financial year
// ---------------------------------------------------------------------------

export interface FinancialYear {
  /** Calendar year the FY starts in. For Indian FY 2025-26 with an April start: 2025. */
  readonly startYear: number;
  readonly startMonth: number;
  readonly start: PeriodId;
  readonly end: PeriodId;
}

function assertFyStartMonth(fyStartMonth: number): void {
  if (!Number.isInteger(fyStartMonth) || fyStartMonth < 1 || fyStartMonth > 12) {
    throw new RangeError(`fyStartMonth ${String(fyStartMonth)} out of range (1-12)`);
  }
}

/** The financial year containing `p`. */
export function financialYearOf(p: PeriodId, fyStartMonth: number): FinancialYear {
  assertFyStartMonth(fyStartMonth);
  const { year, month } = periodParts(p);
  const startYear = month >= fyStartMonth ? year : year - 1;
  const start = periodId(startYear, fyStartMonth);
  return { startYear, startMonth: fyStartMonth, start, end: addMonths(start, 11) };
}

/**
 * The label for a financial year, e.g. `"2025-26"`.
 *
 * A January-start FY spans a single calendar year, so it labels as `"2025"` -- not
 * `"2025-25"`. Invoice numbering uses this (SPEC §13: `INV/2026-27/000123`).
 */
export function financialYearLabel(fy: FinancialYear): string {
  if (fy.startMonth === 1) return fy.startYear.toString();
  const endShort = ((fy.startYear + 1) % 100).toString().padStart(2, "0");
  return `${fy.startYear.toString()}-${endShort}`;
}

/** Every period in a financial year, in order. Always 12. */
export const periodsInFinancialYear = (fy: FinancialYear): PeriodId[] =>
  periodRange(fy.start, fy.end);

/** Periods from the start of `p`'s financial year up to and including `p`. */
export function yearToDate(p: PeriodId, fyStartMonth: number): PeriodId[] {
  return periodRange(financialYearOf(p, fyStartMonth).start, p);
}

/** Whether a calendar date falls inside a financial year. */
export function isInFinancialYear(d: CalendarDate, fy: FinancialYear): boolean {
  return (
    compareCalendarDates(d, periodStartDate(fy.start)) >= 0 &&
    compareCalendarDates(d, periodEndDate(fy.end)) <= 0
  );
}
