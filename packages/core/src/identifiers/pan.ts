/**
 * PAN — Permanent Account Number.
 *
 * SPEC §17 lists the detector as `[A-Z]{5}[0-9]{4}[A-Z]`. PAN carries no checksum, so
 * shape plus the structural rules below is as far as validation can go.
 *
 * Structure: AAAAA9999A
 *   [0-2]  alphabetic series
 *   [3]    holder type
 *   [4]    first letter of surname (individual) or entity name
 *   [5-8]  sequence
 *   [9]    check letter (not a computable checksum)
 */

export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/u;

/** The 4th character encodes who holds the PAN. */
export const PAN_HOLDER_TYPES: Readonly<Record<string, string>> = {
  A: "Association of Persons",
  B: "Body of Individuals",
  C: "Company",
  F: "Firm / LLP",
  G: "Government",
  H: "Hindu Undivided Family",
  J: "Artificial Juridical Person",
  L: "Local Authority",
  P: "Individual",
  T: "Trust",
};

export const hasPanShape = (value: string): boolean => PAN_PATTERN.test(value);

/**
 * Shape plus a recognised holder-type character.
 *
 * Stricter than the SPEC §17 detector regex on purpose: the detector casts a wide net so
 * redaction never misses a PAN, while this is for validating something a user typed as
 * their own PAN.
 */
export function isValidPan(value: string): boolean {
  if (!PAN_PATTERN.test(value)) return false;
  const holderType = value[3] ?? "";
  return holderType in PAN_HOLDER_TYPES;
}

export function panHolderType(value: string): string | null {
  if (!isValidPan(value)) return null;
  return PAN_HOLDER_TYPES[value[3] ?? ""] ?? null;
}

export const normalisePan = (value: string): string =>
  value.replace(/\s+/gu, "").toUpperCase();
