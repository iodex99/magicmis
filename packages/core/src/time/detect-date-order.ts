/**
 * Working out the date order of a **column**, as evidence rather than a guess.
 *
 * `parse-date.ts` refuses to flip on a single value above 12, and that refusal is right:
 * one date cannot tell you the order, and a per-value heuristic reads `05/04/2025` wrong
 * silently. A whole column is a different question. If any row has a first group above 12
 * the column cannot be month-first, because there is no thirteenth month — that is
 * deduction, not a heuristic.
 *
 * So this returns what the data actually proves:
 *
 * - **`day_first` / `month_first`** — proved. At least one row is impossible the other way.
 * - **`ambiguous`** — every value works both ways. A column of `01/02/2025`-shaped dates
 *   from the first twelve days of a month is genuinely undecidable, and saying so is the
 *   honest answer.
 * - **`inconsistent`** — rows prove *both*, so the column mixes orders or holds something
 *   that is not a date. Never resolve this by majority: the file is wrong and a person
 *   needs to know.
 *
 * Used to check a company's stated setting, never to override it silently. A contradiction
 * stops the job — a wrong month is the one data error where every total still reconciles.
 */

import type { DateOrder } from "./parse-date";

export type DetectedDateOrder = DateOrder | "ambiguous" | "inconsistent";

export interface DateOrderEvidence {
  readonly order: DetectedDateOrder;
  /** Rows that can only be day-first: a first group above 12. */
  readonly dayFirstOnly: number;
  /** Rows that can only be month-first: a second group above 12. */
  readonly monthFirstOnly: number;
  /** Rows that work either way and prove nothing. */
  readonly ambiguous: number;
  /** A value of each kind that decided it, for a message a person can act on. */
  readonly dayFirstExample: string | null;
  readonly monthFirstExample: string | null;
}

/** Only the two-number form is ambiguous; ISO and named months are not. */
const TWO_NUMBERS = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](?:\d{2}|\d{4})$/u;

export function detectDateOrder(values: Iterable<string>): DateOrderEvidence {
  let dayFirstOnly = 0;
  let monthFirstOnly = 0;
  let ambiguous = 0;
  let dayFirstExample: string | null = null;
  let monthFirstExample: string | null = null;

  for (const raw of values) {
    const m = TWO_NUMBERS.exec(raw.trim());
    if (m === null) continue;
    // Day and month components, never an amount: the repository's money rule bans bare
    // Number() because it loses precision on a value that could be paise.
    const first = Number.parseInt(m[1] ?? "", 10);
    const second = Number.parseInt(m[2] ?? "", 10);
    // A zero in either position is not a date in either order; it proves nothing.
    if (first === 0 || second === 0) continue;

    const canBeDayFirst = second <= 12;
    const canBeMonthFirst = first <= 12;

    if (canBeDayFirst && !canBeMonthFirst) {
      dayFirstOnly += 1;
      dayFirstExample ??= raw.trim();
    } else if (canBeMonthFirst && !canBeDayFirst) {
      monthFirstOnly += 1;
      monthFirstExample ??= raw.trim();
    } else if (canBeDayFirst && canBeMonthFirst) {
      ambiguous += 1;
    }
    // Neither: both groups above 12, so it is not a date in any order. Ignored here —
    // the parser reports it as a data-quality finding on its own.
  }

  const order: DetectedDateOrder =
    dayFirstOnly > 0 && monthFirstOnly > 0
      ? "inconsistent"
      : dayFirstOnly > 0
        ? "day_first"
        : monthFirstOnly > 0
          ? "month_first"
          : "ambiguous";

  return {
    order,
    dayFirstOnly,
    monthFirstOnly,
    ambiguous,
    dayFirstExample,
    monthFirstExample,
  };
}

export type DateOrderCheck =
  | { readonly ok: true; readonly evidence: DateOrderEvidence }
  | {
      readonly ok: false;
      readonly evidence: DateOrderEvidence;
      readonly message: string;
    };

/**
 * Check a column against the order the company says it uses.
 *
 * Ambiguous passes: the data does not disagree, and the setting is the only thing anyone
 * knows. A contradiction fails with a message naming the value that proves it, because
 * "dates look wrong" is not something a person can act on and `31/12/2025` is.
 */
export function checkDateOrder(
  stated: DateOrder,
  values: Iterable<string>,
): DateOrderCheck {
  const evidence = detectDateOrder(values);
  if (evidence.order === "ambiguous" || evidence.order === stated) {
    return { ok: true, evidence };
  }

  if (evidence.order === "inconsistent") {
    return {
      ok: false,
      evidence,
      message: `This column mixes date orders: ${String(evidence.dayFirstExample)} can only be day-first and ${String(evidence.monthFirstExample)} can only be month-first. One of them is not the date it appears to be, so no setting makes this file right — check the export.`,
    };
  }

  const proof =
    evidence.order === "day_first"
      ? evidence.dayFirstExample
      : evidence.monthFirstExample;
  const detected = evidence.order === "day_first" ? "day-first" : "month-first";
  const setting = stated === "day_first" ? "day-first" : "month-first";
  return {
    ok: false,
    evidence,
    message: `This company reads dates as ${setting}, but this file is ${detected}: ${String(proof)} is only a date that way round. Reading it as ${setting} would move entries into the wrong month, and every total would still balance — so nothing is generated until the setting or the file is corrected.`,
  };
}

/**
 * The order to read one column in (ADR 0031).
 *
 * When the column's own values prove an order, that order is used even against the
 * company's setting: a file whose dates can only be month-first is month-first, and reading
 * it the other way would move entries between months. Refusing the file instead turned an
 * export from another system into a dead end. The setting decides only when the values are
 * ambiguous. A column that proves both orders at once has no safe reading and returns null,
 * so the caller keeps its values as text rather than guessing a date.
 */
export function resolveDateOrder(
  stated: DateOrder,
  values: Iterable<string>,
): DateOrder | null {
  const { order } = detectDateOrder(values);
  if (order === "inconsistent") return null;
  return order === "ambiguous" ? stated : order;
}
