/**
 * Parsing and formatting for integer paise.
 *
 * Display formatting (lakhs/crores grouping) lives in `../format` -- this module only
 * converts between paise and canonical decimal strings, which is what the database and
 * the wire format use.
 */

import { PAISE_PER_RUPEE, paise, type Paise } from "./brand";
import { formatDecimal, parseDecimal } from "./decimal";
import { divideRounded, type RoundingMode } from "./rounding";

/**
 * Parse a rupee amount given as a canonical decimal string into paise.
 *
 * Rejects more than two decimal places rather than rounding: a third decimal in an
 * amount means the caller's data is not actually in rupees, and silently dropping it
 * would lose money invisibly. Round explicitly first if that is what you meant.
 */
export function rupeeStringToPaise(input: string): Paise {
  const d = parseDecimal(input);
  if (d.scale > 2) {
    throw new RangeError(
      `rupeeStringToPaise: ${JSON.stringify(input)} has ${String(d.scale)} decimal places; rupees have at most 2`,
    );
  }
  const factor = 10n ** BigInt(2 - d.scale);
  return paise(d.unscaled * factor);
}

/** Render paise as a canonical rupee string with exactly two decimals: `"1234.50"`. */
export function paiseToRupeeString(value: Paise): string {
  return formatDecimal({ unscaled: value, scale: 2 });
}

/** Whole rupees as a bigint, discarding paise under the named mode. */
export function paiseToWholeRupees(value: Paise, mode: RoundingMode): bigint {
  return divideRounded(value, PAISE_PER_RUPEE, mode);
}

/** Exact rupees → paise for a whole-rupee amount. */
export function wholeRupeesToPaise(rupees: bigint): Paise {
  return paise(rupees * PAISE_PER_RUPEE);
}

/**
 * Widen a branded value back to a plain bigint.
 *
 * `-somePaise` is rejected by @typescript-eslint/no-unsafe-unary-minus, because the
 * brand intersection is not literally `bigint`. Dropping the brand here is the honest
 * fix -- the alternative is suppressing a rule that exists to catch negating a string.
 */
const raw = (v: Paise): bigint => v;

export const addPaise = (a: Paise, b: Paise): Paise => paise(a + b);
export const subtractPaise = (a: Paise, b: Paise): Paise => paise(a - b);
export const negatePaise = (a: Paise): Paise => paise(-raw(a));
export const absPaise = (a: Paise): Paise => paise(a < 0n ? -raw(a) : a);

/** Sum without an intermediate rounding step (SPEC §20: totals come from unrounded values). */
export const sumPaise = (values: readonly Paise[]): Paise =>
  paise(values.reduce<bigint>((acc, v) => acc + v, 0n));
