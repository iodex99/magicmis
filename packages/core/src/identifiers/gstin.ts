/**
 * GSTIN — Goods and Services Tax Identification Number.
 *
 * SPEC §8 requires the format *and the checksum* to be validated at signup, and SPEC §13
 * takes the place of supply from the GSTIN's leading state code. A shape-only check would
 * accept a transposed digit and put the wrong state on a tax invoice.
 *
 * Structure, 15 characters:
 *   [0-1]   state code, 2 digits
 *   [2-11]  PAN of the registrant, 10 characters
 *   [12]    entity number for that PAN in that state, 1 alphanumeric
 *   [13]    'Z' by default
 *   [14]    check character
 *
 * SPEC §17: a GSTIN embeds a PAN, so it is always tokenised before leaving the browser.
 */

import { PAN_PATTERN } from "./pan";

/** The check-character alphabet: 0-9 then A-Z, giving modulus 36. */
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const MODULUS = 36;

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{1}Z[0-9A-Z]$/u;

/**
 * Compute the check character for the first 14 characters of a GSTIN.
 *
 * Each position is weighted alternately 1 and 2, walking right to left from position 13
 * with a factor of 2. Products are folded (`floor(p/36) + p%36`) before summing, so a
 * doubled value above the modulus still contributes both of its digits — the same
 * structure as the Luhn algorithm, in base 36.
 */
export function gstinCheckCharacter(first14: string): string {
  if (first14.length !== 14) {
    throw new RangeError(
      `gstinCheckCharacter: expected 14 characters, got ${String(first14.length)}`,
    );
  }

  let factor = 2;
  let sum = 0;

  for (let i = first14.length - 1; i >= 0; i--) {
    const codePoint = ALPHABET.indexOf(first14[i] ?? "");
    if (codePoint < 0) {
      throw new RangeError(
        `gstinCheckCharacter: ${JSON.stringify(first14[i])} is not in the alphabet`,
      );
    }
    let addend = factor * codePoint;
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / MODULUS) + (addend % MODULUS);
    sum += addend;
  }

  const checkCodePoint = (MODULUS - (sum % MODULUS)) % MODULUS;
  return ALPHABET[checkCodePoint] ?? "";
}

/** Shape only. Use `isValidGstin` for anything that matters. */
export const hasGstinShape = (value: string): boolean => GSTIN_PATTERN.test(value);

/** Full validation: shape, embedded PAN, and check character. */
export function isValidGstin(value: string): boolean {
  if (!GSTIN_PATTERN.test(value)) return false;
  if (!PAN_PATTERN.test(value.slice(2, 12))) return false;
  return gstinCheckCharacter(value.slice(0, 14)) === value[14];
}

/**
 * The 2-digit state code, or `null` if the GSTIN is invalid.
 *
 * SPEC §13: place of supply comes from the buyer's billing state, or from this when a
 * GSTIN is on file. Same state as the seller → CGST + SGST; different → IGST.
 */
export function gstinStateCode(value: string): string | null {
  if (!isValidGstin(value)) return null;
  return value.slice(0, 2);
}

/** The embedded PAN, or `null` if the GSTIN is invalid. */
export function gstinPan(value: string): string | null {
  if (!isValidGstin(value)) return null;
  return value.slice(2, 12);
}

/**
 * Normalise user input before validating: trim and upper-case, strip internal spaces.
 *
 * People paste GSTINs out of letterheads with spacing. Normalising is not the same as
 * accepting a malformed value — the result still has to pass `isValidGstin`.
 */
export const normaliseGstin = (value: string): string =>
  value.replace(/\s+/gu, "").toUpperCase();
