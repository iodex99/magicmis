/**
 * Header detection (SPEC §15).
 *
 * Candidate rows near the top are scored on text density, uniqueness, type contrast with the
 * rows below, and known header vocabulary. A header may span two rows (e.g. a merged
 * "Closing Balance" above "Debit | Credit"); levels are concatenated. Rows above the header
 * are title rows: the first becomes the company name and period text becomes metadata.
 */

import { formatIso, parseDayFirst } from "@magicmis/core/time";

import {
  cellAt,
  columnCount,
  isBlankCell,
  isBlankRow,
  type Cell,
  type SheetGrid,
} from "./grid";
import { classifyCell } from "./infer";

export interface HeaderDetection {
  /** 0-based first and last header rows (inclusive). */
  readonly headerStart: number;
  readonly headerEnd: number;
  /** 0-based first body row. */
  readonly bodyStart: number;
  /** One per column; unnamed columns become `Column N`. */
  readonly headers: readonly string[];
  readonly titleLines: readonly string[];
  readonly companyName: string | null;
  /** ISO dates from period text like "1-Apr-25 to 31-Mar-26". */
  readonly period: { readonly from: string; readonly to: string } | null;
  readonly asAt: string | null;
  readonly confidence: number;
}

const VOCABULARY = [
  "particulars",
  "ledger",
  "account",
  "group",
  "debit",
  "credit",
  "dr",
  "cr",
  "opening",
  "closing",
  "balance",
  "date",
  "voucher",
  "vch",
  "type",
  "no",
  "amount",
  "value",
  "name",
  "gstin",
  "uin",
  "qty",
  "quantity",
  "rate",
  "total",
  "party",
  "bill",
  "ref",
  "due",
  "pending",
  "overdue",
  "days",
  "employee",
  "emp",
  "salary",
  "basic",
  "hra",
  "pf",
  "esi",
  "tds",
  "gross",
  "net",
  "pay",
  "narration",
  "invoice",
  "taxable",
  "igst",
  "cgst",
  "sgst",
  "cess",
  "item",
  "stock",
  "godown",
  "inwards",
  "outwards",
  "transactions",
  "code",
  "designation",
  "department",
  "month",
  "period",
].map((w) => w.toLowerCase());

const SCAN_ROWS = 40;
const CONTRAST_ROWS = 12;

const cellWords = (cell: Cell): string[] =>
  cell.text
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);

function rowCells(sheet: SheetGrid, r: number, width: number): Cell[] {
  return Array.from({ length: width }, (_, c) => cellAt(sheet, r, c));
}

function scoreRow(sheet: SheetGrid, r: number, width: number): number {
  const cells = rowCells(sheet, r, width);
  const filled = cells.filter((c) => !isBlankCell(c));
  if (filled.length < 2) return -1;
  const textCells = filled.filter((c) => classifyCell(c) === "text");
  const textRatio = textCells.length / filled.length;
  if (textRatio < 0.6) return -1;
  const unique =
    new Set(filled.map((c) => c.text.trim().toLowerCase())).size / filled.length;
  const vocabHits =
    filled.filter((c) => cellWords(c).some((w) => VOCABULARY.includes(w))).length /
    filled.length;

  // Contrast: columns headed by text whose body below is typed (amount, date, …).
  let contrastCols = 0;
  let consideredCols = 0;
  for (let c = 0; c < width; c += 1) {
    if (isBlankCell(cells[c])) continue;
    let typed = 0;
    let seen = 0;
    for (let k = r + 1; k < Math.min(sheet.rows.length, r + 1 + CONTRAST_ROWS); k += 1) {
      const below = cellAt(sheet, k, c);
      if (isBlankCell(below)) continue;
      seen += 1;
      if (classifyCell(below) !== "text") typed += 1;
    }
    if (seen === 0) continue;
    consideredCols += 1;
    if (typed / seen >= 0.5) contrastCols += 1;
  }
  const contrast = consideredCols === 0 ? 0 : contrastCols / consideredCols;
  const density = filled.length / Math.max(width, 1);

  return (
    textRatio * 1.0 + unique * 0.8 + vocabHits * 1.5 + contrast * 1.5 + density * 1.2
  );
}

const PERIOD =
  /(\d{1,2}[-/.\s][A-Za-z]{3,9}[-/.\s]\d{2,4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\s*(?:to|-|–)\s*(\d{1,2}[-/.\s][A-Za-z]{3,9}[-/.\s]\d{2,4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/iu;
const AS_AT =
  /\bas\s+(?:at|on)\s+(\d{1,2}[-/.\s][A-Za-z]{3,9}[-/.\s]\d{2,4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/iu;

export function parsePeriodText(text: string): { from: string; to: string } | null {
  const m = PERIOD.exec(text);
  if (!m) return null;
  const from = parseDayFirst((m[1] ?? "").replace(/\s+/gu, "-"));
  const to = parseDayFirst((m[2] ?? "").replace(/\s+/gu, "-"));
  return from && to ? { from: formatIso(from), to: formatIso(to) } : null;
}

export function parseAsAtText(text: string): string | null {
  const m = AS_AT.exec(text);
  if (!m) return null;
  const d = parseDayFirst((m[1] ?? "").replace(/\s+/gu, "-"));
  return d ? formatIso(d) : null;
}

/** Carry a merged or blank-to-the-right parent label across the columns it spans. */
function spannedLabels(sheet: SheetGrid, r: number, width: number): string[] {
  const labels = rowCells(sheet, r, width).map((c) => c.text.trim());
  for (const m of sheet.merges) {
    if (m.startRow <= r && r <= m.endRow) {
      const label = cellAt(sheet, m.startRow, m.startCol).text.trim();
      for (let c = m.startCol; c <= Math.min(m.endCol, width - 1); c += 1)
        labels[c] = label;
    }
  }
  return labels;
}

export function detectHeader(sheet: SheetGrid): HeaderDetection | null {
  const width = columnCount(sheet);
  if (width === 0) return null;
  const limit = Math.min(sheet.rows.length, SCAN_ROWS);

  let best = -1;
  let bestScore = 0;
  for (let r = 0; r < limit; r += 1) {
    if (isBlankRow(sheet.rows[r])) continue;
    const s = scoreRow(sheet, r, width);
    if (s > bestScore) {
      best = r;
      bestScore = s;
    }
  }
  if (best < 0) return null;

  let headerStart = best;
  let headerEnd = best;
  let headers = rowCells(sheet, best, width).map((c) => c.text.trim());

  // Two-level header: this row is sub-labels (Debit | Credit) under a parent row above, or
  // the next row is sub-labels under this one.
  const combine = (parentRow: number, childRow: number): string[] | null => {
    const parent = spannedLabels(sheet, parentRow, width);
    // Without merges (CSV), a group label sits in its first column only: carry it right
    // across child labels until the next parent label.
    const rawChild = rowCells(sheet, childRow, width).map((c) => c.text.trim());
    for (let c = 1; c < width; c += 1) {
      if (
        (parent[c] ?? "") === "" &&
        (rawChild[c] ?? "") !== "" &&
        (rawChild[c - 1] ?? "") !== ""
      ) {
        parent[c] = parent[c - 1] ?? "";
      }
    }
    const child = rowCells(sheet, childRow, width).map((c) => c.text.trim());
    const childFilled = child.filter(Boolean);
    const childText = child.every(
      (t, c) => t === "" || classifyCell(cellAt(sheet, childRow, c)) === "text",
    );
    if (childFilled.length === 0 || !childText) return null;
    // A real two-level header has a parent label spanning at least two adjacent columns that
    // carry distinct sub-labels ("Closing Balance" over "Debit | Credit"). A lone text row
    // under a single-column label is a body row (e.g. a party heading), not a header level.
    let spans = false;
    for (let c = 0; c + 1 < width; c += 1) {
      const p = parent[c] ?? "";
      const a = child[c] ?? "";
      const b = child[c + 1] ?? "";
      if (p !== "" && parent[c + 1] === p && a !== "" && b !== "" && a !== b)
        spans = true;
    }
    if (!spans) return null;
    return parent.map((p, c) =>
      [p, child[c] ?? ""]
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(" "),
    );
  };

  if (best > 0 && !isBlankRow(sheet.rows[best - 1])) {
    const up = combine(best - 1, best);
    const upScore = scoreRow(sheet, best - 1, width);
    if (up !== null && upScore > 0) {
      headerStart = best - 1;
      headers = up;
    }
  }
  if (headerStart === best && best + 1 < sheet.rows.length) {
    const down = combine(best, best + 1);
    if (down !== null) {
      headerEnd = best + 1;
      headers = down;
    }
  }

  const titleLines: string[] = [];
  for (let r = 0; r < headerStart; r += 1) {
    const line = rowCells(sheet, r, width)
      .map((c) => c.text.trim())
      .filter(Boolean)
      .join(" ");
    if (line !== "") titleLines.push(line);
  }
  const allTitle = titleLines.join(" \n ");
  const period = parsePeriodText(allTitle);

  let bodyStart = headerEnd + 1;
  while (bodyStart < sheet.rows.length && isBlankRow(sheet.rows[bodyStart]))
    bodyStart += 1;

  return {
    headerStart,
    headerEnd,
    bodyStart,
    headers: headers.map((h, i) =>
      h === "" ? `Column ${(i + 1).toString()}` : h.replace(/\s+/gu, " "),
    ),
    titleLines,
    companyName: titleLines[0] ?? null,
    period,
    asAt: period === null ? parseAsAtText(allTitle) : null,
    confidence: Math.min(1, bestScore / 6),
  };
}

/** Normalised header name for signatures and matching: lowercase, alphanumeric words. */
export const normaliseHeader = (h: string): string =>
  h
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
