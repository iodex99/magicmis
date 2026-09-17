import { parseDate, type DateOrder } from "./parse-date";
import { periodId, periodOf, type PeriodId } from "./period";

/**
 * The reporting month named anywhere in free text: a report title, a sheet name, a file name
 * (ADR 0031).
 *
 * Exports from accounting systems other than Tally often state their period in a form the
 * header parser does not expect — "As of March 31, 2026", "TB_Mar-2026.xlsx", "2026-03 trial
 * balance" — or only in the file name. Dropping the balances because the title was worded
 * differently turned a routine upload into a failed job, so every common spelling is read here.
 *
 * Dates beat bare months; when a text names several, the latest wins, because a period
 * ("1 April 2025 to 31 March 2026") is reported at its end. Returns null rather than guess
 * when nothing unambiguous is present.
 */

const MONTHS =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

const MONTH_INDEX: Readonly<Record<string, number>> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const monthOf = (name: string): number | undefined =>
  MONTH_INDEX[name.slice(0, 3).toLowerCase()];

const year4 = (y: string): number => {
  const n = Number.parseInt(y, 10);
  return y.length === 2 ? 2000 + n : n;
};

const B = "(?<![A-Za-z0-9])";
const E = "(?![A-Za-z0-9])";

/** "31 March 2026", "31-Mar-26", "31/03/2026", "2026-03-31". */
const DAY_FIRST_DATES = new RegExp(
  `${B}(\\d{1,2}[\\s\\-/.]*(?:${MONTHS})[\\s\\-/.,]*\\d{2,4}|\\d{1,2}[/\\-.]\\d{1,2}[/\\-.]\\d{2,4}|\\d{4}-\\d{1,2}-\\d{1,2})${E}`,
  "giu",
);
/** "March 31, 2026", "Mar 31 2026". */
const MONTH_FIRST_NAMED = new RegExp(
  `${B}(${MONTHS})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})${E}`,
  "giu",
);
/** "March 2026", "Mar-26", "Mar'26", "Mar26". */
const MONTH_YEAR = new RegExp(`${B}(${MONTHS})[\\s\\-_/.,']*(\\d{4}|\\d{2})${E}`, "giu");
/** "2026-03", "2026_03", "2026.03". */
const YEAR_MONTH = new RegExp(`${B}(20\\d{2})[\\-_./](0?[1-9]|1[0-2])${E}`, "gu");
/** "03-2026", "3/2026". */
const MONTH_YEAR_NUMERIC = new RegExp(`${B}(0?[1-9]|1[0-2])[\\-_./](20\\d{2})${E}`, "gu");

const plausible = (p: PeriodId): boolean => {
  const year = Number.parseInt(p.slice(0, 4), 10);
  return year >= 1990 && year <= 2100;
};

const latest = (periods: readonly PeriodId[]): PeriodId | null =>
  periods.filter(plausible).sort().at(-1) ?? null;

export function periodFromText(
  text: string,
  order: DateOrder = "day_first",
): PeriodId | null {
  const dated: PeriodId[] = [];
  for (const m of text.matchAll(DAY_FIRST_DATES)) {
    const d = parseDate((m[1] ?? "").replace(/[\s,]+/gu, "-"), { order });
    if (d !== null) dated.push(periodOf(d));
  }
  for (const m of text.matchAll(MONTH_FIRST_NAMED)) {
    const month = monthOf(m[1] ?? "");
    if (month !== undefined) dated.push(periodId(Number.parseInt(m[3] ?? "", 10), month));
  }
  const fromDates = latest(dated);
  if (fromDates !== null) return fromDates;

  const months: PeriodId[] = [];
  for (const m of text.matchAll(MONTH_YEAR)) {
    const month = monthOf(m[1] ?? "");
    if (month !== undefined) months.push(periodId(year4(m[2] ?? ""), month));
  }
  for (const m of text.matchAll(YEAR_MONTH))
    months.push(
      periodId(Number.parseInt(m[1] ?? "", 10), Number.parseInt(m[2] ?? "", 10)),
    );
  for (const m of text.matchAll(MONTH_YEAR_NUMERIC))
    months.push(
      periodId(Number.parseInt(m[2] ?? "", 10), Number.parseInt(m[1] ?? "", 10)),
    );
  return latest(months);
}
