/**
 * Reference MIS layout extraction (SPEC §22), in the browser. Reads the workbook's structure with
 * ExcelJS 4.4.0 (SheetJS community builds do not read cell styles, and bold and indent are part of
 * the layout): sheet order, row labels in order, section headers, column headers and their period
 * patterns, bold and indent, formulas as text, and number formats. Values are never read into the
 * layout. Formula text is reduced to row references with numeric literals removed, so no amount
 * can travel inside it. The caller redacts labels and headers before anything leaves the browser.
 *
 * API used (package type declarations): `new Workbook().xlsx.load(buffer)`, `eachSheet`,
 * `worksheet.state`, `rowCount`, `columnCount`, `getCell(r, c)` with `value`, `formula`, `numFmt`,
 * `font.bold`, `alignment.indent`.
 */

import type { ColumnPattern, ReferenceLayout } from "@magicmis/templates";
import ExcelJS from "exceljs";

const MAX_SHEETS = 20;
const MAX_ROWS = 400;
const MAX_COLUMNS = 60;
const HEADER_SCAN_ROWS = 15;

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

/** Column header → period pattern. Month names or dates are month columns. */
export function classifyHeader(header: string): ColumnPattern {
  const h = header
    .toLowerCase()
    .replace(/[^a-z0-9%]+/gu, " ")
    .trim();
  const has = (...words: string[]) =>
    words.some((w) => new RegExp(`(^| )${w}( |$)`, "u").test(h));
  const pct = h.includes("%") || has("pct", "percent", "percentage", "growth");
  if (has("ly ytd", "py ytd", "last year ytd", "previous year ytd", "prior year ytd"))
    return "ly_ytd";
  if (has("ytd", "year to date", "cumulative")) return "ytd";
  if (has("yoy", "year on year")) return pct ? "yoy_pct" : "yoy_abs";
  if (has("same month last year", "same month ly", "sply", "last year", "ly", "py"))
    return "same_month_ly";
  if (has("mom", "month on month")) return pct ? "mom_pct" : "mom_abs";
  if (has("variance", "var", "change", "diff", "difference"))
    return pct ? "mom_pct" : "variance";
  if (has("previous month", "prev month", "last month", "prior month", "pm"))
    return "previous";
  if (has("current month", "this month", "cm", "mtd", "actual", "actuals"))
    return "current";
  if (MONTHS.some((m) => new RegExp(`(^| )${m}[a-z]*( |$)`, "u").test(h))) return "month";
  if (
    /^(0?[1-9]|1[0-2]) (19|20)?\d{2}$/u.test(h) ||
    /^(19|20)\d{2} (0?[1-9]|1[0-2])$/u.test(h)
  )
    return "month";
  return "other";
}

type Raw = string | number | Date | { formula: string } | null;

function raw(cell: ExcelJS.Cell): Raw {
  const formula = (cell as { formula?: unknown }).formula;
  if (typeof formula === "string" && formula !== "") return { formula };
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  if (v instanceof Date) return v;
  if (typeof v === "object" && "richText" in v)
    return v.richText.map((t) => t.text).join("");
  if (typeof v === "object" && "text" in v && typeof v.text === "string") return v.text;
  return null;
}

const isText = (r: Raw): r is string => typeof r === "string" && r.trim() !== "";
const isValue = (r: Raw) =>
  typeof r === "number" || (r !== null && typeof r === "object" && "formula" in r);

const colLetters = (n: number): string => {
  let s = "";
  let x = n;
  while (x > 0) {
    const rem = (x - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    x = (x - 1 - rem) / 26;
  }
  return s;
};

/** Rewrites cell references as row refs and removes numeric literals. */
function sanitiseFormula(formula: string, sheetRef: string): string {
  return formula
    .replace(
      /\$?([A-Z]{1,3})\$?(\d{1,7})/gu,
      (_m, _c: string, r: string) => `${sheetRef}r${r}`,
    )
    .replace(/(?<![A-Za-z0-9_])\d+(\.\d+)?(?![A-Za-z0-9_])/gu, "n")
    .slice(0, 400);
}

/** Terms of a plain signed sum of cells or ranges in one column, or null. */
export function sumTerms(
  formula: string,
  column: string,
): { row: number; sign: 1 | -1 }[] | null {
  const f = formula
    .replace(/^=/u, "")
    .replace(/\s+/gu, "")
    .replace(/\$/gu, "")
    .toUpperCase();
  const token =
    /^([+-]?)(?:SUM\(([A-Z]{1,3})(\d{1,7}):([A-Z]{1,3})(\d{1,7})\)|([A-Z]{1,3})(\d{1,7}))/u;
  const terms: { row: number; sign: 1 | -1 }[] = [];
  let rest = f;
  while (rest !== "") {
    const m = token.exec(rest);
    if (m === null) return null;
    const sign = m[1] === "-" ? -1 : 1;
    if (m[2] !== undefined) {
      if (m[2] !== column || m[4] !== column) return null;
      const from = Number.parseInt(m[3] ?? "", 10);
      const to = Number.parseInt(m[5] ?? "", 10);
      for (let r = Math.min(from, to); r <= Math.max(from, to); r += 1)
        terms.push({ row: r, sign });
    } else {
      if (m[6] !== column) return null;
      terms.push({ row: Number.parseInt(m[7] ?? "", 10), sign });
    }
    rest = rest.slice(m[0].length);
  }
  return terms.length === 0 ? null : terms;
}

const monthLabel = (d: Date) =>
  `${MONTHS[d.getUTCMonth()] ?? ""} ${d.getUTCFullYear().toString()}`.replace(
    /^./u,
    (c) => c.toUpperCase(),
  );

export interface ExtractedLayout {
  /** Unredacted: stays in the browser until labels and headers are redacted. */
  readonly layout: ReferenceLayout;
  readonly hiddenSheets: readonly string[];
  readonly truncated: boolean;
}

export async function extractReferenceLayout(
  bytes: Uint8Array,
): Promise<ExtractedLayout> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const sheets: ReferenceLayout["sheets"] = [];
  const hiddenSheets: string[] = [];
  let truncated = false;

  wb.eachSheet((ws) => {
    if (ws.state !== "visible") {
      hiddenSheets.push(ws.name);
      return;
    }
    if (sheets.length >= MAX_SHEETS) {
      truncated = true;
      return;
    }
    const sheetRef = `s${(sheets.length + 1).toString()}`;
    const lastRow = Math.min(ws.rowCount, MAX_ROWS + HEADER_SCAN_ROWS);
    const lastCol = Math.min(ws.columnCount, MAX_COLUMNS);
    if (ws.rowCount > lastRow || ws.columnCount > lastCol) truncated = true;
    const at = (r: number, c: number) => raw(ws.getCell(r, c));

    // Label column: most text cells among the first three columns.
    let labelCol = 1;
    let best = -1;
    for (let c = 1; c <= Math.min(3, lastCol); c += 1) {
      let n = 0;
      for (let r = 1; r <= lastRow; r += 1) if (isText(at(r, c))) n += 1;
      if (n > best) {
        best = n;
        labelCol = c;
      }
    }

    // Header row: most text or date cells right of the labels, with values somewhere below.
    let headerRow = 0;
    let headerScore = 0;
    for (let r = 1; r <= Math.min(HEADER_SCAN_ROWS, lastRow); r += 1) {
      let score = 0;
      for (let c = labelCol + 1; c <= lastCol; c += 1) {
        const v = at(r, c);
        if (isText(v) || v instanceof Date) score += 1;
      }
      let valuesBelow = false;
      for (let rr = r + 1; rr <= Math.min(r + 5, lastRow) && !valuesBelow; rr += 1)
        for (let c = labelCol + 1; c <= lastCol; c += 1)
          if (isValue(at(rr, c))) valuesBelow = true;
      if (score > headerScore && valuesBelow) {
        headerScore = score;
        headerRow = r;
      }
    }

    const columns: ReferenceLayout["sheets"][number]["columns"] = [];
    const valueCols: number[] = [];
    for (let c = labelCol + 1; c <= lastCol; c += 1) {
      const v = headerRow === 0 ? null : at(headerRow, c);
      const header =
        v instanceof Date ? monthLabel(v) : isText(v) ? v.trim().slice(0, 200) : "";
      if (header === "") continue;
      valueCols.push(c);
      columns.push({
        ref: `${sheetRef}c${c.toString()}`,
        header,
        pattern: classifyHeader(header),
      });
    }

    const rows: ReferenceLayout["sheets"][number]["rows"] = [];
    for (let r = headerRow + 1; r <= lastRow && rows.length < MAX_ROWS; r += 1) {
      const labelCell = ws.getCell(r, labelCol);
      const labelRaw = at(r, labelCol);
      const label = isText(labelRaw) ? labelRaw : "";
      const firstValue = valueCols.find((c) => isValue(at(r, c)));
      if (label.trim() === "" && firstValue === undefined) continue;
      const leading = /^\s*/u.exec(label)?.[0].length ?? 0;
      const indent = Math.min(
        4,
        (labelCell.alignment as Partial<ExcelJS.Alignment> | undefined)?.indent ??
          Math.floor(leading / 2),
      );
      let formula: string | null = null;
      let sumOf: { row: string; sign: 1 | -1 }[] | null = null;
      let numberFormat: string | null = null;
      if (firstValue !== undefined) {
        const cell = ws.getCell(r, firstValue);
        const v = raw(cell);
        const fmt: unknown = cell.numFmt;
        numberFormat = typeof fmt === "string" && fmt !== "" ? fmt : null;
        if (v !== null && typeof v === "object" && "formula" in v) {
          formula = sanitiseFormula(v.formula, sheetRef);
          const terms = sumTerms(v.formula, colLetters(firstValue));
          sumOf =
            terms === null
              ? null
              : terms.map((t) => ({
                  row: `${sheetRef}r${t.row.toString()}`,
                  sign: t.sign,
                }));
        }
      }
      rows.push({
        ref: `${sheetRef}r${r.toString()}`,
        label: label.trim().slice(0, 200),
        bold: (labelCell.font as Partial<ExcelJS.Font> | undefined)?.bold === true,
        indent,
        hasValues: firstValue !== undefined,
        formula,
        sumOf,
        numberFormat,
      });
    }
    // Ranges cover blank and heading rows too; keep only terms that are rows with values.
    const withValues = new Set(rows.filter((x) => x.hasValues).map((x) => x.ref));
    const cleaned = rows.map((row) => {
      const kept = (row.sumOf ?? []).filter(
        (t) => withValues.has(t.row) && t.row !== row.ref,
      );
      return { ...row, sumOf: kept.length === 0 ? null : kept };
    });
    if (cleaned.length > 0)
      sheets.push({ ref: sheetRef, name: ws.name, columns, rows: cleaned });
  });

  if (sheets.length === 0)
    throw new Error("The reference MIS has no visible sheet with rows.");
  return { layout: { sheets }, hiddenSheets, truncated };
}

/** Labels and headers through the session redactor, before the layout leaves the browser (SPEC §17). */
export async function redactReferenceLayout(
  layout: ReferenceLayout,
  redactText: (text: string) => Promise<string>,
): Promise<ReferenceLayout> {
  const sheets = [];
  for (const s of layout.sheets) {
    const columns = [];
    for (const c of s.columns) columns.push({ ...c, header: await redactText(c.header) });
    const rows = [];
    for (const r of s.rows) rows.push({ ...r, label: await redactText(r.label) });
    sheets.push({ ...s, name: await redactText(s.name), columns, rows });
  }
  return { sheets };
}
