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

/**
 * Western grouping — thousand, million, billion — for a dollar amount (ADR 0030).
 *
 * Separate from the Indian version rather than parameterised: the two differ in their
 * grouping *and* in the words, and a function that switched between them on a flag would
 * be read by nobody and trusted by no auditor. Both are short.
 */
export function numberInWordsWestern(value: bigint): string {
  if (value < 0n) throw new RangeError("numberInWordsWestern: negative value");
  if (value === 0n) return "Zero";

  const SCALES: readonly [bigint, string][] = [
    [1_000_000_000_000n, "Trillion"],
    [1_000_000_000n, "Billion"],
    [1_000_000n, "Million"],
    [1_000n, "Thousand"],
  ];
  const parts: string[] = [];
  let n = value;
  for (const [size, name] of SCALES) {
    const count = n / size;
    n %= size;
    if (count > 0n) parts.push(`${numberInWordsWestern(count)} ${name}`);
  }
  if (n >= 100n) {
    parts.push(`${below100(n / 100n)} Hundred`);
    n %= 100n;
  }
  if (n > 0n) parts.push(below100(n));
  return parts.join(" ");
}

/** `"Dollars One Thousand Two Hundred and Fifty Cents Only"` for an export invoice. */
export function amountInWordsUsd(amountCents: bigint): string {
  if (amountCents < 0n) throw new RangeError("amountInWordsUsd: negative amount");
  const dollars = amountCents / 100n;
  const cents = amountCents % 100n;
  const dollarPart = `Dollars ${numberInWordsWestern(dollars)}`;
  return cents === 0n
    ? `${dollarPart} Only`
    : `${dollarPart} and ${below100(cents)} Cents Only`;
}

/** The amount in words for whichever currency the invoice is in. */
export function amountInWords(currency: "INR" | "USD", minor: bigint): string {
  return currency === "INR" ? amountInWordsIndian(minor) : amountInWordsUsd(minor);
}
