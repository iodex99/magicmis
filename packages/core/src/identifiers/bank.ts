/**
 * Bank identifiers.
 *
 * SPEC §17 detectors:
 *   - IFSC: `[A-Z]{4}0[A-Z0-9]{6}` — the 5th character is always a literal zero,
 *     reserved for future use, which is what makes the pattern discriminating.
 *   - Bank account numbers: 9–18 digits, **only in account-labelled columns**. There is
 *     no checksum and no fixed length, so a bare digit-run detector would redact
 *     invoice numbers and amounts. Column context does the work.
 */

const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/u;
const ACCOUNT_DIGITS = /^\d{9,18}$/u;

export const isValidIfsc = (value: string): boolean => IFSC_PATTERN.test(value);

/** The 4-letter bank code, or `null`. */
export function ifscBankCode(value: string): string | null {
  return isValidIfsc(value) ? value.slice(0, 4) : null;
}

export const normaliseIfsc = (value: string): string =>
  value.replace(/\s+/gu, "").toUpperCase();

/**
 * Whether a value *could* be a bank account number.
 *
 * Deliberately shape-only, and deliberately not exported as "isValidAccountNumber":
 * nothing here can tell an account number from any other 9–18 digit run. The caller
 * must supply column context, which is why redaction pairs this with a header heuristic.
 */
export const couldBeAccountNumber = (value: string): boolean =>
  ACCOUNT_DIGITS.test(value.replace(/[\s-]/gu, ""));

/** SPEC §17: UAN is 12 digits, and like account numbers is only trusted in a labelled column. */
export const couldBeUan = (value: string): boolean => /^\d{12}$/u.test(value.replace(/[\s-]/gu, ""));
