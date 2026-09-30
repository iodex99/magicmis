/**
 * Number formats (SPEC §24.1). Indian lakh/crore grouping uses digit placeholders around literal
 * commas, chosen per cell from the value's digit count (Excel fills placeholders right to left and
 * suppresses empty leading `#`). Negatives in brackets per the template. The display is rounded;
 * the stored value is not.
 *
 * Opened in Excel and compared cell by cell with the screen's own formatter (R-35,
 * `format-proof.ts`), which found two things this now handles:
 *
 * - **The digit count is the displayed value's, after rounding.** ₹99,99,999.99 shown with no
 *   decimals reads 1,00,00,000, one digit longer than the stored value: a pattern sized from the
 *   stored value put the extra digit into the leading group, `100,00,000`.
 * - **A value that rounds to zero shows zero.** Excel picks a section by the stored value's sign,
 *   so a loss of one paisa read `(0)` or `-0` where the board says `0` — and in millions, every
 *   loss under half a million did.
 *
 * `absolute` and `millions` use the format's own thousands separator, which a spreadsheet draws in
 * the reader's regional convention: `1,234,567.89` in the US or the UK, `1.234.567,89` in
 * Germany. Literal commas would force the first shape on everyone, and beside a decimal comma
 * would print `1,234,567,89`, which is a figure misread. Lakh grouping has no regional form
 * outside India, so it is literal.
 */

export type NumberStyle = "lakhs_crores" | "absolute" | "millions";

function lakhPattern(digits: number): string {
  // Up to 5 integer digits the Western "#,##0" grouping is identical to the Indian one.
  if (digits <= 5) return "#,##0";
  // Indian grouping: last three digits, then pairs.
  const groups = ["##0"];
  let remaining = digits - 3;
  while (remaining > 0) {
    groups.unshift("##");
    remaining -= 2;
  }
  return groups.join("\\,");
}

const fraction = (decimals: number): string =>
  decimals === 0 ? "" : `.${"0".repeat(decimals)}`;

/**
 * `abs` paise as the reader will see it: in rupees (or millions of them) at `decimals` places,
 * rounded half away from zero as a spreadsheet rounds a display, scaled to an integer.
 */
function displayed(abs: bigint, style: NumberStyle, decimals: number): bigint {
  const divisor = style === "millions" ? 100n * 1_000_000n : 100n;
  const scaled = abs * 10n ** BigInt(decimals);
  return (scaled * 2n + divisor) / (divisor * 2n);
}

/** Format for a money amount whose engine value (in paise) is known. */
export function moneyFormat(
  paise: bigint,
  style: NumberStyle,
  decimals: number,
  negativesInBrackets: boolean,
): string {
  const abs = paise < 0n ? -paise : paise;
  const shown = displayed(abs, style, decimals);
  const wholeDigits = (shown / 10n ** BigInt(decimals)).toString().length;
  const body =
    style === "lakhs_crores"
      ? `${lakhPattern(wholeDigits)}${fraction(decimals)}`
      : style === "millions"
        ? `#,##0${fraction(decimals)},,`
        : `#,##0${fraction(decimals)}`;
  const zero = `0${fraction(decimals)}`;
  // The sign of a value that displays as zero is not a figure anyone should read. The section
  // still formats the value itself (it holds digit placeholders, so the reader's decimal mark
  // is kept), which is why it needs the millions scaling too: unscaled, a loss of ₹123.45
  // printed as `123.45` under a millions heading.
  const negative =
    paise < 0n && shown === 0n
      ? `${zero}${style === "millions" ? ",," : ""}`
      : negativesInBrackets
        ? `\\(${body}\\)`
        : `\\-${body}`;
  return `${body};${negative};${zero}`;
}

export const PERCENT_FORMAT = "0.00;\\(0.00\\);0.00";
export const RATIO_FORMAT = "0.00;\\-0.00;0.00";
export const DAYS_FORMAT = "#,##0.0;\\(#,##0.0\\);0.0";
