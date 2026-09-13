/**
 * Amount parsing (SPEC §15).
 *
 * - Indian (`1,00,000.00`) and international (`100,000.00`) grouping.
 * - Parentheses mean negative.
 * - A trailing `Dr`/`Cr` is **recorded** as a side, never folded into a sign here: which side
 *   is positive depends on the report and the column, and SPEC §15 forbids guessing silently.
 *   The caller applies an explicit convention recorded in the profile.
 * - Results are integer paise. Excel stores numbers as doubles; the shortest round-trip
 *   decimal of the double is taken and rounded half-up to the paisa. That single rounding
 *   happens here, at the input boundary, and is covered by tests.
 */

import { divideRounded, parseDecimal } from "@magicmis/core/money";

export type DrCr = "dr" | "cr";

export interface ParsedAmount {
  /** Signed by minus sign or parentheses only. Dr/Cr is reported separately. */
  readonly paise: bigint;
  readonly side: DrCr | null;
  readonly parenthesised: boolean;
  readonly grouping: "indian" | "international" | "none";
}

const CURRENCY = /^(?:₹|rs\.?|inr)\s*/iu;
const SIDE = /\s*\b(dr|cr)\.?$/iu;
const INDIAN_GROUPED = /^\d{1,2}(,\d{2})*,\d{3}(\.\d+)?$/u;
const INTL_GROUPED = /^\d{1,3}(,\d{3})+(\.\d+)?$/u;
const PLAIN = /^\d+(\.\d+)?$/u;

/** Decimal string (any scale) → paise, half-up at the input boundary. */
export function decimalStringToPaise(input: string): bigint {
  const d = parseDecimal(input);
  const scaled = d.unscaled * 100n;
  return divideRounded(scaled, 10n ** BigInt(d.scale), "half_up");
}

/** Shortest round-trip decimal for a finite double, without exponent notation. */
export function numberToDecimalString(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  const s = String(n);
  if (!/e/iu.test(s)) return s;
  // Very large or tiny values: expand the exponent exactly from the round-trip digits.
  const match = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/iu.exec(s);
  if (!match) return null;
  const [, sign = "", lead = "", frac = "", expText = "0"] = match;
  const exp = Number.parseInt(expText, 10);
  const digits = lead + frac;
  const point = 1 + exp;
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length)
    return `${sign}${digits}${"0".repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

export function parseAmount(input: string | number): ParsedAmount | null {
  if (typeof input === "number") {
    const s = numberToDecimalString(input);
    if (s === null) return null;
    return {
      paise: decimalStringToPaise(s),
      side: null,
      parenthesised: false,
      grouping: "none",
    };
  }

  // Non-breaking spaces (U+00A0) are common in exported numbers.
  let s = input.trim().split(String.fromCharCode(0xa0)).join(" ");
  if (s === "") return null;

  let side: DrCr | null = null;
  const sideMatch = SIDE.exec(s);
  if (sideMatch) {
    side = (sideMatch[1] ?? "").toLowerCase() === "dr" ? "dr" : "cr";
    s = s.slice(0, sideMatch.index).trim();
  }

  let negative = false;
  let parenthesised = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    parenthesised = true;
    negative = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(CURRENCY, "");
  if (s.startsWith("-")) {
    if (negative) return null; // "(-5)" is not a convention anyone uses on purpose
    negative = true;
    s = s.slice(1).trim();
  } else if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1).trim();
  }
  s = s.replace(CURRENCY, "");

  let grouping: ParsedAmount["grouping"] = "none";
  if (s.includes(",")) {
    // A value like 1,000 or 100,000 fits both systems; it is international-shaped, and the
    // digits are identical either way. Only lakh-style groups are called Indian.
    if (INTL_GROUPED.test(s)) grouping = "international";
    else if (INDIAN_GROUPED.test(s)) grouping = "indian";
    else return null;
    s = s.replace(/,/gu, "");
  } else if (!PLAIN.test(s)) {
    return null;
  }
  if (!PLAIN.test(s)) return null;

  const paise = decimalStringToPaise(s);
  return { paise: negative ? -paise : paise, side, parenthesised, grouping };
}
