/**
 * Invoice total in words, Indian system (SPEC §13; CGST Rule 46 requires the value of
 * supply — "in figures and words" is the SPEC's requirement). Crore, lakh, thousand,
 * hundred. TODO(review): R-06 — confirm the wording convention with the CA.
 */

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
] as const;
const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
] as const;

function below100(n: bigint): string {
  const i = Number.parseInt(n.toString(), 10);
  if (i < 20) return ONES[i] ?? "";
  const unit = ONES[i % 10] ?? "";
  const ten = TENS[Math.floor(i / 10)] ?? "";
  return unit === "" ? ten : `${ten} ${unit}`;
}

function below1000(n: bigint): string {
  const hundreds = n / 100n;
  const rest = n % 100n;
  const parts: string[] = [];
  if (hundreds > 0n) parts.push(`${below100(hundreds)} Hundred`);
  if (rest > 0n) parts.push(below100(rest));
  return parts.join(" ");
}

/** A non-negative whole number in words, Indian grouping. Zero is "Zero". */
export function numberInWordsIndian(value: bigint): string {
  if (value < 0n) throw new RangeError("numberInWordsIndian: negative value");
  if (value === 0n) return "Zero";

  const parts: string[] = [];
  let n = value;
  const crores = n / 10_000_000n;
  n %= 10_000_000n;
  // Above 99 crore the crore count itself is spelled in Indian grouping ("One Hundred Crore").
  if (crores > 0n) parts.push(`${numberInWordsIndian(crores)} Crore`);
  const lakhs = n / 100_000n;
  n %= 100_000n;
  if (lakhs > 0n) parts.push(`${below100(lakhs)} Lakh`);
  const thousands = n / 1000n;
  n %= 1000n;
  if (thousands > 0n) parts.push(`${below100(thousands)} Thousand`);
  if (n > 0n) parts.push(below1000(n));
  return parts.join(" ");
}

/** "Rupees Two Thousand Three Hundred Sixty and Fifty Paise Only". */
export function amountInWordsIndian(amountPaise: bigint): string {
  if (amountPaise < 0n) throw new RangeError("amountInWordsIndian: negative amount");
  const rupees = amountPaise / 100n;
  const paise = amountPaise % 100n;
  const rupeePart = `Rupees ${numberInWordsIndian(rupees)}`;
  return paise === 0n
    ? `${rupeePart} Only`
    : `${rupeePart} and ${below100(paise)} Paise Only`;
}
