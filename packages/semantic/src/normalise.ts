/**
 * Name normalisation for matching (SPEC §18): lowercase, `&` → "and", strip punctuation and
 * extra spaces, expand abbreviations from the maintained list, remove trailing numeric suffixes
 * and dates. Idempotent.
 */

import { ABBREVIATIONS } from "./abbreviations";

const MONTHS =
  "jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december";

// Trailing dates or periods: "fy 2025 26", "2025-26", "mar 2026", "31 03 2026", "q1".
const TRAILING = new RegExp(
  [
    String.raw`(?:\s+(?:fy|f y|ay)?\s*\d{1,4}(?:\s+\d{2,4}){0,2})+$`,
    String.raw`(?:\s+(?:${MONTHS})(?:\s+\d{2,4})?)+$`,
    String.raw`(?:\s+q[1-4])+$`,
  ].join("|"),
  "u",
);

const ABBREV = new Map(Object.entries(ABBREVIATIONS));

export function normaliseName(raw: string): string {
  let s = raw
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/gu, " and ")
    // "a/c", "p&l" style abbreviations lose their punctuation but stay one token.
    .replace(/\b([a-z])\/([a-z])\b/gu, "$1$2")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();

  s = s
    .split(" ")
    .map((w) => ABBREV.get(w) ?? w)
    .join(" ");

  for (;;) {
    const next = s.replace(TRAILING, "").trim();
    if (next === s || next === "") break;
    s = next;
  }
  return s.replace(/\s+/gu, " ").trim();
}
