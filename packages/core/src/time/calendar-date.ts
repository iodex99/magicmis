/**
 * A calendar date with no time and no zone.
 *
 * Dates read out of a trial balance are calendar facts, not instants: "1-Apr-25" is the
 * first of April wherever the reader is standing. Parsing them into a `Date` would
 * attach a timezone and let a UTC/IST shift move a voucher into the previous month --
 * which is exactly the class of bug that produces a wrong MIS.
 *
 * Instants (created_at, login times) use `Date` and are stored UTC, displayed IST
 * (SPEC §2.14). Those are a different thing and live in ./ist.
 */

export interface CalendarDate {
  readonly year: number;
  /** 1-12. Not the JavaScript 0-11 convention -- that convention causes off-by-one bugs. */
  readonly month: number;
  readonly day: number;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12)
    throw new RangeError(`daysInMonth: month ${String(month)} out of range`);
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month - 1] ?? 0;
}

export function isValidCalendarDate(d: CalendarDate): boolean {
  if (
    !Number.isInteger(d.year) ||
    !Number.isInteger(d.month) ||
    !Number.isInteger(d.day)
  ) {
    return false;
  }
  if (d.month < 1 || d.month > 12) return false;
  if (d.day < 1) return false;
  return d.day <= daysInMonth(d.year, d.month);
}

export function calendarDate(year: number, month: number, day: number): CalendarDate {
  const d = { year, month, day };
  if (!isValidCalendarDate(d)) {
    throw new RangeError(
      `calendarDate: ${String(year)}-${String(month)}-${String(day)} is not a real date`,
    );
  }
  return d;
}

/** ISO 8601 `YYYY-MM-DD`. The canonical form for storage and comparison. */
export function formatIso(d: CalendarDate): string {
  const y = d.year.toString().padStart(4, "0");
  const m = d.month.toString().padStart(2, "0");
  const day = d.day.toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function compareCalendarDates(a: CalendarDate, b: CalendarDate): number {
  if (a.year !== b.year) return a.year < b.year ? -1 : 1;
  if (a.month !== b.month) return a.month < b.month ? -1 : 1;
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  return 0;
}
