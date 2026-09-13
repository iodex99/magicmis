/**
 * Number formats (SPEC §24.1). Indian lakh/crore grouping uses digit placeholders around literal
 * commas, chosen per cell from the value's digit count (Excel fills placeholders right to left and
 * suppresses empty leading `#`). Negatives in brackets per the template. The display is rounded;
 * the stored value is not.
 *
 * TODO(review): R-35 — render the saved fixture workbook in Excel and LibreOffice and confirm the
 * lakh/crore codes, negatives and zero display as intended.
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

/** Format for a rupee amount whose engine value (in paise) is known. */
export function moneyFormat(
  paise: bigint,
  style: NumberStyle,
  decimals: number,
  negativesInBrackets: boolean,
): string {
  const abs = paise < 0n ? -paise : paise;
  const rupeeDigits = (abs / 100n).toString().length;
  const body =
    style === "lakhs_crores"
      ? `${lakhPattern(rupeeDigits)}${fraction(decimals)}`
      : style === "millions"
        ? `#,##0${fraction(decimals)},,`
        : `#,##0${fraction(decimals)}`;
  const negative = negativesInBrackets ? `\\(${body}\\)` : `\\-${body}`;
  const zero = `0${fraction(decimals)}`;
  return `${body};${negative};${zero}`;
}

export const PERCENT_FORMAT = "0.00;\\(0.00\\);0.00";
export const RATIO_FORMAT = "0.00;\\-0.00;0.00";
export const DAYS_FORMAT = "#,##0.0;\\(#,##0.0\\);0.0";
