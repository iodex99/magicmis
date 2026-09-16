/**
 * Date parsing, in a stated order.
 *
 * India writes day-first and the United States writes month-first, so with the product
 * sold worldwide (ADR 0030) the order is a **per-company setting**, not a constant. It
 * still defaults to day-first, which is what SPEC §2.14 fixed and what every Tally
 * export uses.
 *
 * **There is still no per-value heuristic**, and that prohibition is the important part
 * of this file. Flipping on seeing a number above 12 gets `05/04/2025` wrong silently,
 * and a silently wrong date moves a voucher into the wrong month and produces an MIS
 * that reconciles perfectly and is wrong.
 *
 * What *is* sound is looking at a whole column: see `detectDateOrder`. One value cannot
 * tell you the order; a column of them often can, and where it can it is evidence rather
 * than a guess. The two are used together — the company states the order, the column is
 * checked against it, and a contradiction stops the job instead of picking a winner.
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
/** Two 1-2 digit groups then a year. Which group is the day is the caller's `order`. */
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

/**
 * Which of the two leading groups is the day.
 *
 * Named rather than a boolean: `parseDate(value, true)` at a call site says nothing,
 * and this is a setting where being wrong is invisible.
 */
export type DateOrder = "day_first" | "month_first";

export interface ParseDateOptions {
  /** Two-digit year pivot. See `expandTwoDigitYear`. */
  readonly twoDigitYearPivot?: number;
  /** Defaults to day-first: SPEC §2.14, and what every Tally export writes. */
  readonly order?: DateOrder;
}

/**
 * Parse a date string in the stated order. Returns `null` for anything unrecognised or
 * invalid, rather than guessing -- the caller surfaces it as a data-quality finding.
 *
 * Recognised (shown day-first, the default):
 *   - `2025-04-01`      ISO, unambiguous whatever the order
 *   - `01/04/2025`      1 April day-first; 4 January month-first
 *   - `1-4-25`          two-digit year
 *   - `1-Apr-25`        named month, unambiguous whatever the order
 *   - `01 April 2025`   named month, spaced
 */
export function parseDate(
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
    // The only place the order matters. Everything else in this function is unambiguous:
    // ISO leads with a four-digit year, and a named month cannot be mistaken for a day.
    const first = num(numeric[1]);
    const second = num(numeric[2]);
    const [day, month] =
      (options.order ?? "day_first") === "day_first" ? [first, second] : [second, first];
    const rawYear = num(numeric[3]);
    const year =
      (numeric[3]?.length ?? 0) === 2 ? expandTwoDigitYear(rawYear, pivot) : rawYear;
    // `build` rejects an impossible month, so `13/01/2025` read month-first is null
    // rather than a silent reinterpretation as 1 January.
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
 * Day-first parsing, the SPEC §2.14 default and what every Tally export writes.
 *
 * Kept as its own name because most call sites are reading Tally, where the order is not
 * a question, and `parseDate(v, { order: "day_first" })` at each of them would be noise
 * around the few places where it genuinely varies.
 */
export function parseDayFirst(
  input: string,
  options: Omit<ParseDateOptions, "order"> = {},
): CalendarDate | null {
  return parseDate(input, { ...options, order: "day_first" });
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
  return parseDate(value, options);
}

/** Re-export for callers that want to construct directly after their own validation. */
export { calendarDate };
