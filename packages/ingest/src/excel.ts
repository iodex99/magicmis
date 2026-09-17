/**
 * Excel → grids with SheetJS 0.20.3, the official distribution from cdn.sheetjs.com (the npm
 * registry copy is stale; SPEC §5). Options verified against the tarball's type declarations:
 *
 * - `cellFormula: false` — formulas are never read, let alone evaluated; cached values only.
 * - `bookVBA: false` — `.xlsm` macro projects are not extracted, never executed.
 * - `cellText: true`, `cellNF: true` — formatted text and number formats for type inference.
 * - `cellStyles: true` — required for row properties: SheetJS 0.20.3 parses `<row hidden>` and
 *   `outlineLevel` into `!rows` only under this option (verified in `xlsx.mjs`,
 *   `parse_ws_xml_data`). `cellHTML: false` — nothing rendered.
 * - `dense: true` — dense row arrays, much smaller for large sheets.
 *
 * Hidden sheets (`Workbook.Sheets[i].Hidden`) and hidden rows (`!rows[r].hidden`) are flagged,
 * never dropped. Merges come from `!merges`.
 */

import * as XLSX from "xlsx";

import type { Cell, SheetGrid, WorkbookGrid } from "./grid";

// Native zlib for unzipping workbooks when running in Node. SheetJS ESM build does not wire it
// up itself and otherwise inflates in pure JavaScript, several times slower on large files.
// In a browser bundle `process` may be a polyfill without getBuiltinModule; check the function.
const nodeZlib: unknown =
  typeof process !== "undefined" && typeof process.getBuiltinModule === "function"
    ? process.getBuiltinModule("node:zlib")
    : undefined;
if (nodeZlib !== undefined)
  (
    XLSX as unknown as { CFB: { utils: { use_zlib(z: unknown): void } } }
  ).CFB.utils.use_zlib(nodeZlib);

export interface ReadExcelOptions {
  /** Read only the first N rows of each sheet (for previews). */
  readonly sheetRows?: number;
  /**
   * Values only: no formatted text, number formats or row styles. About twice as fast on a
   * large workbook, and enough for counting sheets and rows before payment (ADR 0032). The
   * paid run always reads the full detail.
   */
  readonly lite?: boolean;
}

// Dense rows can have holes at runtime (empty rows), which the published types omit.
interface DenseSheet {
  "!data"?: ((XLSX.CellObject | undefined)[] | undefined)[];
  "!rows"?: (XLSX.RowInfo | undefined)[];
  "!merges"?: XLSX.Range[];
}

function toCell(c: XLSX.CellObject | undefined): Cell | undefined {
  if (c === undefined || c.t === "z") return undefined;
  let value: Cell["value"];
  switch (c.t) {
    case "n":
      value = typeof c.v === "number" ? c.v : null;
      break;
    case "b":
      value = typeof c.v === "boolean" ? c.v : null;
      break;
    case "s":
      value = typeof c.v === "string" ? c.v : null;
      break;
    case "d":
      value = c.v instanceof Date ? c.v.toISOString().slice(0, 10) : null;
      break;
    case "e":
      value = null;
      break;
    default:
      value = null;
  }
  const text = typeof c.w === "string" ? c.w : value === null ? "" : String(value);
  const format = typeof c.z === "string" ? c.z : undefined;
  return format === undefined ? { value, text } : { value, text, format };
}

export function readExcel(
  bytes: Uint8Array,
  options: ReadExcelOptions = {},
): WorkbookGrid {
  const wb = XLSX.read(bytes, {
    type: "array",
    dense: true,
    cellFormula: false,
    bookVBA: false,
    cellText: options.lite !== true,
    cellNF: options.lite !== true,
    cellStyles: options.lite !== true,
    cellHTML: false,
    cellDates: false,
    ...(options.sheetRows === undefined ? {} : { sheetRows: options.sheetRows }),
  });
  const meta = wb.Workbook?.Sheets ?? [];

  const sheets: SheetGrid[] = wb.SheetNames.map((name, index) => {
    const ws = wb.Sheets[name] as unknown as DenseSheet | undefined;
    const data = ws?.["!data"] ?? [];
    // Array.from, not map: dense rows and cells have holes for empty rows and cells, and
    // map preserves holes, which would surface as undefined rows downstream.
    const rows = Array.from(data, (row) => Array.from(row ?? [], toCell));
    const hiddenRows: number[] = [];
    const outlineLevels: (number | undefined)[] = [];
    (ws?.["!rows"] ?? []).forEach((r, i) => {
      if (r?.hidden) hiddenRows.push(i);
      if (r?.level !== undefined && r.level > 0) outlineLevels[i] = r.level;
    });
    const merges = (ws?.["!merges"] ?? []).map((m) => ({
      startRow: m.s.r,
      startCol: m.s.c,
      endRow: m.e.r,
      endCol: m.e.c,
    }));
    const hiddenFlag = meta[index]?.Hidden ?? 0;
    return { name, hidden: hiddenFlag !== 0, rows, hiddenRows, merges, outlineLevels };
  });
  return { sheets };
}

/**
 * Grids back into an .xlsx workbook, for readers that accept only .xlsx (the reference MIS
 * layout reader, which uses ExcelJS). Values and text only; styling cannot survive a format
 * that never had it (ADR 0031).
 */
export function sheetsToXlsx(sheets: readonly SheetGrid[]): Uint8Array {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const sheet of sheets) {
    const rows = sheet.rows.map((row) =>
      Array.from(row, (c) => (c === undefined ? null : (c.value ?? c.text))),
    );
    let name = sheet.name.replace(/[\\/?*[\]:]/gu, " ").slice(0, 31) || "Sheet";
    for (let i = 2; used.has(name); i += 1) name = `${name.slice(0, 28)} ${i.toString()}`;
    used.add(name);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return new Uint8Array(
    XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer,
  );
}

/**
 * Sheet and non-blank row counts, without building cells (ADR 0032). Before payment only counts
 * are shown, and on a 50 MB workbook building three million cells to count rows costs more than
 * reading the file.
 */
export function countExcel(bytes: Uint8Array): { sheets: number; rows: number } {
  const wb = XLSX.read(bytes, {
    type: "array",
    dense: true,
    cellFormula: false,
    bookVBA: false,
    cellText: false,
    cellNF: false,
    cellStyles: false,
    cellHTML: false,
    cellDates: false,
  });
  let rows = 0;
  for (const name of wb.SheetNames) {
    const data = (wb.Sheets[name] as unknown as DenseSheet | undefined)?.["!data"] ?? [];
    for (const row of data) {
      if (row === undefined) continue;
      for (const c of row) {
        if (c === undefined || c.t === "z" || c.v === undefined) continue;
        if (typeof c.v === "string" && c.v.trim() === "") continue;
        rows += 1;
        break;
      }
    }
  }
  return { sheets: wb.SheetNames.length, rows };
}
