/**
 * Column type inference (SPEC §15).
 *
 * Each column gets one type from its non-blank body cells, with the share of cells that fit
 * it. Nothing is coerced silently: a column that is mostly dates with a few unreadable values
 * is typed `date` and the misfits are counted, so profiling can report them as findings.
 */

import { excelSerialToCalendarDate, formatIso, parseDayFirst } from "@magicmis/core/time";

import { parseAmount, type DrCr } from "./amounts";
import { isBlankCell, type Cell } from "./grid";

export type ColumnType =
  | "date"
  | "amount"
  | "integer"
  | "percent"
  | "gstin"
  | "pan"
  | "ifsc"
  | "email"
  | "mobile"
  | "text"
  | "empty";

export interface ColumnInference {
  readonly type: ColumnType;
  readonly nonBlank: number;
  /** Cells that fit `type`. */
  readonly fitting: number;
  /** For amounts: which Dr/Cr suffixes appeared. Both present means a signed-by-side column. */
  readonly drCrSuffixes: readonly DrCr[];
  readonly parenthesesNegative: boolean;
  readonly grouping: readonly ("indian" | "international")[];
  readonly distinct: number;
}

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/u;
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/u;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/u;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u;
const MOBILE = /^(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}$/u;
const PERCENT = /^-?\d+(\.\d+)?\s*%$/u;
const INTEGER_TEXT = /^-?\d+$/u;

/** Excel date formats contain d, m or y outside quoted literals and are not pure time. */
export function isDateFormat(format: string | undefined): boolean {
  if (format === undefined) return false;
  const stripped = format.replace(/"[^"]*"|\[[^\]]*\]|\\./gu, "");
  return /[dy]/iu.test(stripped) || /m{3,}/iu.test(stripped);
}

/** A cell as a day-first ISO date, or null. Excel serials only when the cell is date-formatted. */
export function cellAsDate(cell: Cell): string | null {
  if (typeof cell.value === "number") {
    if (!isDateFormat(cell.format)) return null;
    const d = excelSerialToCalendarDate(cell.value);
    return d === null ? null : formatIso(d);
  }
  if (typeof cell.value !== "string") return null;
  const d = parseDayFirst(cell.value);
  return d === null ? null : formatIso(d);
}

export function classifyCell(cell: Cell): ColumnType {
  if (isBlankCell(cell)) return "empty";
  if (cellAsDate(cell) !== null) return "date";
  const text = cell.text.trim();
  if (typeof cell.value === "string") {
    const upper = text.toUpperCase();
    if (GSTIN.test(upper)) return "gstin";
    if (PAN.test(upper)) return "pan";
    if (IFSC.test(upper)) return "ifsc";
    if (EMAIL.test(text)) return "email";
    if (MOBILE.test(text)) return "mobile";
    if (PERCENT.test(text)) return "percent";
  }
  if (typeof cell.value === "number" && /%/u.test(cell.format ?? "")) return "percent";
  if (typeof cell.value === "number")
    return Number.isInteger(cell.value) && !/[.,]/u.test(cell.text)
      ? "integer"
      : "amount";
  if (INTEGER_TEXT.test(text) && text.length < 16) return "integer";
  if (parseAmount(text) !== null) return "amount";
  return "text";
}

const PRECEDENCE: readonly ColumnType[] = [
  "date",
  "gstin",
  "pan",
  "ifsc",
  "email",
  "mobile",
  "percent",
  "amount",
  "integer",
  "text",
];

export function inferColumn(cells: readonly (Cell | undefined)[]): ColumnInference {
  const counts = new Map<ColumnType, number>();
  const suffixes = new Set<DrCr>();
  const grouping = new Set<"indian" | "international">();
  const distinct = new Set<string>();
  let parentheses = false;
  let nonBlank = 0;

  for (const cell of cells) {
    if (cell === undefined || isBlankCell(cell)) continue;
    nonBlank += 1;
    distinct.add(cell.text.trim());
    const type = classifyCell(cell);
    counts.set(type, (counts.get(type) ?? 0) + 1);
    if (type === "amount" || type === "integer") {
      const parsed = parseAmount(typeof cell.value === "number" ? cell.value : cell.text);
      if (parsed?.side) suffixes.add(parsed.side);
      if (parsed?.parenthesised) parentheses = true;
      if (parsed && parsed.grouping !== "none") grouping.add(parsed.grouping);
    }
  }

  if (nonBlank === 0) {
    return {
      type: "empty",
      nonBlank: 0,
      fitting: 0,
      drCrSuffixes: [],
      parenthesesNegative: false,
      grouping: [],
      distinct: 0,
    };
  }

  // Integers inside an amount column are amounts (e.g. "1,200" next to "1,200.50").
  const amountLike = (counts.get("amount") ?? 0) + (counts.get("integer") ?? 0);
  let best: ColumnType = "text";
  let bestCount = 0;
  for (const type of PRECEDENCE) {
    const n =
      type === "amount" && (counts.get("amount") ?? 0) > 0
        ? amountLike
        : (counts.get(type) ?? 0);
    if (n > bestCount) {
      best = type;
      bestCount = n;
    }
  }
  // A column is typed only when a clear majority fits; otherwise it is text.
  if (best !== "text" && bestCount * 10 < nonBlank * 6) {
    best = "text";
    bestCount = counts.get("text") ?? 0;
  }

  return {
    type: best,
    nonBlank,
    fitting: bestCount,
    drCrSuffixes: [...suffixes].sort(),
    parenthesesNegative: parentheses,
    grouping: [...grouping].sort(),
    distinct: distinct.size,
  };
}
