/**
 * Instants: stored UTC, displayed IST (SPEC §2.14, §4).
 *
 * IST is UTC+05:30 with no daylight saving, ever. That makes the conversion a fixed
 * offset rather than a timezone-database lookup, so it needs no `Intl` dependency and
 * cannot shift under a tzdata update.
 *
 * These are for instants -- `created_at`, login times, "generated at" on the Excel
 * cover. Dates read out of source files are calendar facts and belong in
 * ./calendar-date instead.
 */

import type { CalendarDate } from "./calendar-date.js";

/** +05:30 in minutes. */
export const IST_OFFSET_MINUTES = 330;
const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60_000;

export interface IstParts {
  readonly year: number;
  /** 1-12. */
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/** Break a UTC instant into its IST wall-clock parts. */
export function toIstParts(instant: Date): IstParts {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

/** The IST calendar date an instant falls on. */
export function istCalendarDate(instant: Date): CalendarDate {
  const p = toIstParts(instant);
  return { year: p.year, month: p.month, day: p.day };
}

/** Build a UTC instant from IST wall-clock parts. */
export function fromIstParts(parts: IstParts): Date {
  const asIfUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return new Date(asIfUtc - IST_OFFSET_MS);
}

const pad = (n: number, width = 2): string => n.toString().padStart(width, "0");

/** `2026-09-11 19:30:42 IST` -- the form used on Excel covers and in the UI. */
export function formatIstDateTime(instant: Date): string {
  const p = toIstParts(instant);
  return (
    `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)} ` +
    `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)} IST`
  );
}

/** `11-09-2026` -- day-first for display, matching how the input was read. */
export function formatIstDate(instant: Date): string {
  const p = toIstParts(instant);
  return `${pad(p.day)}-${pad(p.month)}-${pad(p.year, 4)}`;
}

/** ISO 8601 with the explicit +05:30 offset, for anywhere the offset must be unambiguous. */
export function formatIstIso(instant: Date): string {
  const p = toIstParts(instant);
  return (
    `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T` +
    `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}+05:30`
  );
}
