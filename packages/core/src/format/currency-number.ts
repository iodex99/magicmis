/**
 * Formatting an `Amount`, whichever currency it is in (ADR 0030).
 *
 * Built on `formatPaise` rather than beside it. Both billing currencies are two-decimal
 * minor units, so the arithmetic is identical and only the grouping and the symbol differ —
 * duplicating the rounding and splitting logic for dollars is how the two would drift.
 *
 * Indian grouping (12,34,567) is applied to rupees and Western grouping (1,234,567) to
 * dollars, which is what a reader of each expects and what neither would think to correct.
 */

import { CURRENCY, type Amount, type Currency } from "../money/currency";
import { paise } from "../money/brand";

import { formatPaise, type NumberFormatOptions } from "./indian-number";

/**
 * The grouping style a currency is read in, unless the caller asks for something else.
 *
 * A company may still choose `millions` or `absolute` for its own MIS — that is a
 * presentation choice about its books. This is the default for money we are charging,
 * where the reader is the customer and the convention is theirs.
 */
export function defaultStyle(currency: Currency): NumberFormatOptions["style"] {
  return CURRENCY[currency].grouping === "indian" ? "lakhs_crores" : "absolute";
}

/**
 * Digits only, with the right grouping and no symbol.
 *
 * `formatPaise` takes the minor units of a two-decimal currency; the brand says "Paise"
 * because that is the type it was written for, and the conversion is exact for any other
 * two-decimal currency. `CURRENCY[...].minorDigits` is asserted to be 2 in the type, so
 * this cannot silently become wrong if a third currency is added — it will not compile.
 */
export function formatAmountDigits(
  value: Amount,
  options?: Partial<NumberFormatOptions>,
): string {
  const style = options?.style ?? defaultStyle(value.currency);
  return formatPaise(paise(value.minor), {
    decimals: options?.decimals ?? 2,
    style,
    ...(options?.rounding === undefined ? {} : { rounding: options.rounding }),
    ...(options?.negativesInBrackets === undefined
      ? {}
      : { negativesInBrackets: options.negativesInBrackets }),
  });
}

/** With the currency symbol: `₹1,23,456.00`, `$1,234.00`. */
export function formatAmount(
  value: Amount,
  options?: Partial<NumberFormatOptions>,
): string {
  return `${CURRENCY[value.currency].symbol}${formatAmountDigits(value, options)}`;
}

/**
 * With the ISO code rather than the symbol: `INR 1,23,456.00`, `USD 1,234.00`.
 *
 * What an invoice uses. `$` is ambiguous across a dozen countries, and an invoice is the
 * document where that ambiguity is least affordable.
 */
export function formatAmountWithCode(
  value: Amount,
  options?: Partial<NumberFormatOptions>,
): string {
  return `${value.currency} ${formatAmountDigits(value, options)}`;
}
