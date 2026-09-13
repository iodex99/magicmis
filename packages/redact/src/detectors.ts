/**
 * PII detectors (SPEC §17).
 *
 * Two kinds:
 * - **Value detectors** find identifiers anywhere in text: GSTIN (always — it embeds a PAN),
 *   PAN, Aadhaar (12 digits, Verhoeff-valid, not starting 0/1), IFSC, email, Indian mobile.
 * - **Column detectors** decide from the header: UAN and bank account numbers (digit runs
 *   with no checksum, trusted only in labelled columns), person-name columns in payroll/HR
 *   sheets, and columns the user marks sensitive.
 *
 * Detectors never run over amount-typed or date-typed cells: a 10-digit amount is not a mobile
 * number and a 12-digit amount is not an Aadhaar number merely by shape.
 */

import {
  couldBeAccountNumber,
  couldBeUan,
  isValidAadhaar,
} from "@magicmis/core/identifiers";

import type { TokenType } from "./tokens";

export interface Span {
  readonly start: number;
  readonly end: number;
  readonly type: TokenType;
  readonly value: string;
}

// Order matters: GSTIN before PAN (a GSTIN contains a PAN), email before anything inside it.
const VALUE_PATTERNS: readonly {
  type: TokenType;
  re: RegExp;
  accept?: (s: string) => boolean;
}[] = [
  { type: "EMAIL", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu },
  { type: "GSTIN", re: /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/gu },
  { type: "IFSC", re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/gu },
  { type: "PAN", re: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/gu },
  {
    type: "AADHAAR",
    // Not inside a longer number or an amount ("1,2345…", "…9012.00").
    re: /(?<![\d.,])[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}(?!\d|[.,]\d)/gu,
    accept: isValidAadhaar,
  },
  {
    type: "MOBILE",
    re: /(?<![\d.,])(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?![\d.,])/gu,
  },
];

/** Non-overlapping identifier spans in free text, earliest and highest-priority first. */
export function findValueSpans(text: string): Span[] {
  const spans: Span[] = [];
  for (const { type, re, accept } of VALUE_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const start = m.index;
      const value = m[0];
      const end = start + value.length;
      if (accept && !accept(value)) continue;
      if (spans.some((s) => start < s.end && end > s.start)) continue;
      spans.push({ start, end, type, value });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

export type ColumnSensitivity = TokenType | null;

const words = (header: string) =>
  header
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();

/** What a column holds, judged from its header alone. */
export function columnSensitivity(
  header: string,
  sheetKind: "payroll" | "other",
): ColumnSensitivity {
  const h = ` ${words(header)} `;
  if (/\buan\b/u.test(h)) return "UAN";
  if (
    /\b(a c|ac|account|acct|bank)\s*(no|number|num)\b|\baccount number\b|\bbank a c\b/u.test(
      h,
    )
  )
    return "BANKAC";
  if (/\baadhaar\b|\baadhar\b|\buid\b/u.test(h)) return "AADHAAR";
  if (/\bpan\b/u.test(h)) return "PAN";
  if (/\bmobile\b|\bphone\b|\bcontact no\b/u.test(h)) return "MOBILE";
  if (/\bemail\b|\be mail\b/u.test(h)) return "EMAIL";
  // SPEC §17 header heuristics for person names: name, employee name, emp name, staff.
  if (sheetKind === "payroll" && /\b(employee name|emp name|staff|name)\b/u.test(h))
    return "PERSON";
  if (/\b(employee name|emp name|staff name)\b/u.test(h)) return "PERSON";
  return null;
}

/** A cell value in a labelled column that the column detector should tokenise. */
export function columnValueMatches(type: TokenType, value: string): boolean {
  const v = value.trim();
  if (v === "") return false;
  switch (type) {
    case "UAN":
      return couldBeUan(v);
    case "BANKAC":
      return couldBeAccountNumber(v);
    case "AADHAAR":
      return isValidAadhaar(v);
    default:
      return true;
  }
}
