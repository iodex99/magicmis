/**
 * Aadhaar — 12 digits with a Verhoeff check digit.
 *
 * SPEC §17 requires the Verhoeff checksum, not just a 12-digit shape. That matters for
 * redaction precision: a bare "12 digits" detector fires on invoice numbers, bank
 * accounts and phone-number pairs, and over-redacting a ledger name breaks mapping.
 *
 * Verhoeff catches all single-digit errors and all adjacent transpositions, which is
 * what makes it a usable discriminator rather than a formality.
 *
 * Aadhaar is never logged, never sent to the model, and is tokenised before egress.
 */

/** Multiplication table for the dihedral group D5. */
const D: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

/** Permutation table, applied by position. */
const P: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** Multiplicative inverse in D5. */
const INV: readonly number[] = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

const DIGITS_ONLY = /^\d+$/u;

/** Verhoeff checksum of a digit string. Zero means valid (the check digit is included). */
export function verhoeffChecksum(digits: string): number {
  let c = 0;
  // Walk right to left without materialising a reversed array. Spreading a string
  // yields code points, which is wrong for anything but ASCII anyway.
  for (let i = 0; i < digits.length; i++) {
    const digit = Number.parseInt(digits[digits.length - 1 - i] ?? "", 10);
    if (Number.isNaN(digit)) return -1; // not a digit: cannot be valid
    c = D[c]?.[P[i % 8]?.[digit] ?? 0] ?? 0;
  }
  return c;
}

/** The Verhoeff check digit for a payload that does not yet carry one. */
export function verhoeffCheckDigit(payload: string): number {
  if (!DIGITS_ONLY.test(payload)) {
    throw new RangeError("verhoeffCheckDigit: payload must be digits only");
  }
  return INV[verhoeffChecksum(`${payload}0`)] ?? 0;
}

export const isValidVerhoeff = (digits: string): boolean =>
  DIGITS_ONLY.test(digits) && verhoeffChecksum(digits) === 0;

/**
 * Full Aadhaar validation: 12 digits, not starting 0 or 1, valid Verhoeff.
 *
 * UIDAI does not issue numbers beginning 0 or 1, so that rule removes a further slice
 * of false positives from numeric columns.
 */
export function isValidAadhaar(value: string): boolean {
  const digits = value.replace(/[\s-]/gu, "");
  if (digits.length !== 12 || !DIGITS_ONLY.test(digits)) return false;
  const first = digits[0];
  if (first === "0" || first === "1") return false;
  return isValidVerhoeff(digits);
}

/**
 * Generate a structurally valid Aadhaar for **test fixtures only**.
 *
 * SPEC §0.8: fixtures are synthetic and generated. This exists so the redaction test
 * suite has positive cases without anyone pasting a real Aadhaar into the repo.
 */
export function synthesiseAadhaarForFixtures(elevenDigits: string): string {
  if (elevenDigits.length !== 11 || !DIGITS_ONLY.test(elevenDigits)) {
    throw new RangeError("synthesiseAadhaarForFixtures: need exactly 11 digits");
  }
  const first = elevenDigits[0];
  if (first === "0" || first === "1") {
    throw new RangeError("synthesiseAadhaarForFixtures: must not start with 0 or 1");
  }
  return `${elevenDigits}${String(verhoeffCheckDigit(elevenDigits))}`;
}
