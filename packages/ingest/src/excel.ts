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

export interface ReadExcelOptions {
  /** Read only the first N rows of each sheet (for previews). */
  readonly sheetRows?: number;
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
    cellText: true,
    cellNF: true,
    cellStyles: true,
    cellHTML: false,
    cellDates: false,
    ...(options.sheetRows === undefined ? {} : { sheetRows: options.sheetRows }),
  });
  const meta = wb.Workbook?.Sheets ?? [];

  const sheets: SheetGrid[] = wb.SheetNames.map((name, index) => {
    const ws = wb.Sheets[name] as unknown as DenseSheet | undefined;
    const data = ws?.["!data"] ?? [];
    const rows = data.map((row) => (row ?? []).map(toCell));
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
