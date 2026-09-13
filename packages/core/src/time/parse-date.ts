/**
 * Day-first date parsing.
 *
 * SPEC §2.14 and §15: dates are parsed as day-first, **never** month-first.
 * `01/04/2025` is 1 April 2025. There is no locale detection, no heuristic that
 * flips on seeing a value above 12, and no month-first fallback -- because a
 * heuristic gets `05/04/2025` wrong silently, and a silently wrong date moves a
 * voucher into the wrong month and produces a wrong MIS that reconciles perfectly.
 *
 * `Date.parse` is never used. It is implementation-defined for non-ISO input and
 * reads `01/04/2025` as 4 January in a US locale.
 */

import { calendarDate, isValidCalendarDate, type CalendarDate } from "./calendar-date";

const MONTH_NAMES: Readonly<Record<string, number>> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/** Unambiguous ISO `YYYY-MM-DD`: a 4-digit leading group can only be a year. */
const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})$/u;
/** `d/m/y`, `d-m-y`, `d.m.y` with a numeric month. Day first, always. */
const NUMERIC = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/u;
/** `1-Apr-25`, `01 April 2025`, `1.apr.2025`. */
const NAMED = /^(\d{1,2})[\s/\-.]*([A-Za-z]{3,9})[\s/\-.]*(\d{2}|\d{4})$/u;

/**
 * Expand a two-digit year.
 *
 * Tally exports use `25` for 2025. The pivot is configurable because the right answer
 * depends on the data: a payroll date of birth and a voucher date want different
 * windows. Default 69 follows the POSIX convention -- 00-68 are 2000s, 69-99 are 1900s.
 */
export function expandTwoDigitYear(yy: number, pivot = 69): number {
  return yy <= pivot ? 2000 + yy : 1900 + yy;
}

export interface ParseDateOptions {
  /** Two-digit year pivot. See `expandTwoDigitYear`. */
  readonly twoDigitYearPivot?: number;
}

/**
 * Parse a date string day-first. Returns `null` for anything unrecognised or invalid,
 * rather than guessing -- the caller surfaces it as a data-quality finding.
 *
 * Recognised:
 *   - `2025-04-01`      ISO, unambiguous
 *   - `01/04/2025`      day-first: 1 April
 *   - `1-4-25`          day-first, two-digit year
 *   - `1-Apr-25`        named month
 *   - `01 April 2025`   named month, spaced
 */
export function parseDayFirst(
  input: string,
  options: ParseDateOptions = {},
): CalendarDate | null {
  const pivot = options.twoDigitYearPivot ?? 69;
  const s = input.trim();
  if (s === "") return null;

  const iso = ISO.exec(s);
  if (iso) return build(num(iso[1]), num(iso[2]), num(iso[3]));

  const numeric = NUMERIC.exec(s);
  if (numeric) {
    const day = num(numeric[1]);
    const month = num(numeric[2]);
    const rawYear = num(numeric[3]);
    const year =
      (numeric[3]?.length ?? 0) === 2 ? expandTwoDigitYear(rawYear, pivot) : rawYear;
    // Day first. `13/01/2025` is 13 January; `01/13/2025` is not a date at all.
    return build(year, month, day);
  }

  const named = NAMED.exec(s);
  if (named) {
    const day = num(named[1]);
    const month = MONTH_NAMES[(named[2] ?? "").toLowerCase()];
    if (month === undefined) return null;
    const rawYear = num(named[3]);
    const year =
      (named[3]?.length ?? 0) === 2 ? expandTwoDigitYear(rawYear, pivot) : rawYear;
    return build(year, month, day);
  }

  return null;
}

function num(s: string | undefined): number {
  return s === undefined ? Number.NaN : Number.parseInt(s, 10);
}

function build(year: number, month: number, day: number): CalendarDate | null {
  const d = { year, month, day };
  return isValidCalendarDate(d) ? d : null;
}

/**
 * Excel serial date → calendar date.
 *
 * Excel's epoch is 1899-12-31 as serial 1, but it also believes 1900 was a leap year
 * (serial 60 is a non-existent 29 Feb 1900) for Lotus 1-2-3 compatibility. Treating the
 * epoch as 1899-12-30 makes every serial from 61 onward correct, which covers every
 * date this product will ever see. Serials at or below 60 are rejected rather than
 * silently shifted by a day.
 */
export function excelSerialToCalendarDate(serial: number): CalendarDate | null {
  if (!Number.isFinite(serial)) return null;
  const whole = Math.trunc(serial);
  if (whole <= 60) return null; // pre-1900-03-01: inside the phantom leap day
  const epochUtcMs = Date.UTC(1899, 11, 30);
  const ms = epochUtcMs + whole * 86_400_000;
  const d = new Date(ms);
  return build(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Calendar date → Excel serial, the inverse of `excelSerialToCalendarDate`. */
export function calendarDateToExcelSerial(d: CalendarDate): number {
  const epochUtcMs = Date.UTC(1899, 11, 30);
  const ms = Date.UTC(d.year, d.month - 1, d.day);
  // Both operands are midnight UTC, so the difference is an exact whole number of
  // 86,400,000 ms days -- UTC has no daylight saving and no leap seconds in this model.
  // The division is therefore exact and needs no rounding step to correct it.
  return (ms - epochUtcMs) / 86_400_000;
}

/**
 * Parse a cell that may hold either text or an Excel serial.
 *
 * SheetJS hands back a number for a date-formatted cell and a string otherwise
 * (SPEC §15), so ingestion needs both paths behind one call.
 */
export function parseCellDate(
  value: string | number,
  options: ParseDateOptions = {},
): CalendarDate | null {
  if (typeof value === "number") return excelSerialToCalendarDate(value);
  return parseDayFirst(value, options);
}

/** Re-export for callers that want to construct directly after their own validation. */
export { calendarDate };
