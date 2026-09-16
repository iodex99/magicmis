/**
 * Loading sheets into DuckDB (SPEC §15): one table per sheet with sanitised names, provenance
 * columns `_file_id`, `_sheet`, `_source_row` (1-based as seen in Excel), and a header map.
 *
 * Written against a minimal async connection so the same code runs on DuckDB-WASM's
 * `AsyncDuckDB` in the browser worker and its Node blocking bindings in tests (same package,
 * same version, same SQL engine). Values are normalised before loading: dates as ISO,
 * amounts as integer paise (BIGINT), text as-is. Body rows are written as CSV into a
 * registered in-memory file and read with explicit column types, never inferred by DuckDB.
 */

import { parseAmount } from "./amounts";
import { cellAt, isBlankRow, type SheetGrid } from "./grid";
import { checkDateOrder, type DateOrder } from "@magicmis/core/time";

import { cellAsDate } from "./infer";
import type { SheetProfile } from "./profile";

export interface DuckConn {
  query(sql: string): Promise<Record<string, unknown>[]>;
  registerFileText(name: string, text: string): Promise<void>;
  dropFile(name: string): Promise<void>;
}

export interface LoadedTable {
  readonly table: string;
  readonly fileId: string;
  readonly sheet: string;
  /** Sanitised column name → original header text. */
  readonly headerMap: Readonly<Record<string, string>>;
  readonly rows: number;
}

const RESERVED = new Set(["_file_id", "_sheet", "_source_row"]);

/** Lowercase snake identifiers, unique within a table, never colliding with provenance. */
export function sanitiseIdentifier(raw: string, taken: Set<string>): string {
  let base = raw
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  if (base === "") base = "col";
  if (/^[0-9]/u.test(base)) base = `c_${base}`;
  if (RESERVED.has(base)) base = `${base}_col`;
  let name = base.slice(0, 60);
  let n = 2;
  while (taken.has(name)) {
    name = `${base.slice(0, 56)}_${n.toString()}`;
    n += 1;
  }
  taken.add(name);
  return name;
}

const quoteIdent = (s: string): string => `"${s.replace(/"/gu, '""')}"`;
const csvField = (s: string): string =>
  /[",\n\r]/u.test(s) ? `"${s.replace(/"/gu, '""')}"` : s;

/**
 * A file whose dates contradict the company's stated order.
 *
 * Its own type because the remedy is a decision, not a retry: either the company's
 * setting is wrong or the export is, and a person has to say which.
 */
export class DateOrderError extends Error {
  readonly code = "date_order_mismatch" as const;
  constructor(message: string) {
    super(message);
    this.name = "DateOrderError";
  }
}

export async function loadSheet(
  conn: DuckConn,
  input: {
    fileId: string;
    sheet: SheetGrid;
    profile: SheetProfile;
    tableTaken: Set<string>;
    /** The company's setting (ADR 0030). Day-first when the caller does not say. */
    dateOrder?: DateOrder;
  },
): Promise<LoadedTable> {
  const { sheet, profile } = input;
  const dateOrder = input.dateOrder ?? "day_first";

  /**
   * Check every date column against the company's setting before loading a row.
   *
   * This is the one data error where nothing downstream notices: read the wrong way
   * round, 03/04 becomes 4 March, a month of vouchers lands in the wrong period, and
   * every total still balances. So it is caught here, at the only point where the raw
   * text is still in hand, and it stops the load rather than producing a workbook.
   */
  for (const c of profile.columns) {
    if (c.type !== "date") continue;
    const seen: string[] = [];
    const from = profile.header?.bodyStart ?? 0;
    for (let r = from; r < sheet.rows.length; r += 1) {
      const cell = cellAt(sheet, r, c.index);
      if (typeof cell.value === "string" && cell.text.trim() !== "") seen.push(cell.text);
    }
    const check = checkDateOrder(dateOrder, seen);
    if (!check.ok) {
      throw new DateOrderError(`${sheet.name} · ${c.header}: ${check.message}`);
    }
  }
  const table = sanitiseIdentifier(
    `s_${input.fileId.slice(0, 8)}_${sheet.name}`,
    input.tableTaken,
  );
  const taken = new Set<string>();
  const cols = profile.columns.map((c) => ({
    ...c,
    name: sanitiseIdentifier(c.header, taken),
  }));
  const headerMap: Record<string, string> = {};
  for (const c of cols) headerMap[c.name] = c.header;

  const sqlType = (t: string): string =>
    t === "amount" ? "BIGINT" : t === "date" ? "DATE" : "VARCHAR";

  const lines: string[] = [];
  const start = profile.header?.bodyStart ?? 0;
  let rows = 0;
  for (let r = start; r < sheet.rows.length; r += 1) {
    if (isBlankRow(sheet.rows[r])) continue;
    const fields = [csvField(input.fileId), csvField(sheet.name), (r + 1).toString()];
    for (const c of cols) {
      const cell = cellAt(sheet, r, c.index);
      if (c.type === "amount") {
        const parsed = parseAmount(
          typeof cell.value === "number" ? cell.value : cell.text,
        );
        // Dr/Cr sides stay in a sibling text column via the original header map; the loaded
        // value is the unsigned-by-side paise. Unparseable cells load as NULL (a finding).
        fields.push(parsed === null ? "" : parsed.paise.toString());
      } else if (c.type === "date") {
        fields.push(cellAsDate(cell, dateOrder) ?? "");
      } else {
        fields.push(csvField(cell.text));
      }
    }
    lines.push(fields.join(","));
    rows += 1;
  }

  const fileName = `${table}.csv`;
  await conn.registerFileText(fileName, lines.join("\n"));
  const columnSpec = [
    `'_file_id': 'VARCHAR'`,
    `'_sheet': 'VARCHAR'`,
    `'_source_row': 'INTEGER'`,
    ...cols.map((c) => `'${c.name}': '${sqlType(c.type)}'`),
  ].join(", ");
  try {
    await conn.query(
      `CREATE OR REPLACE TABLE ${quoteIdent(table)} AS SELECT * FROM read_csv('${fileName}',
         header = false, delim = ',', quote = '"', escape = '"', dateformat = '%Y-%m-%d',
         nullstr = '', columns = {${columnSpec}})`,
    );
  } finally {
    await conn.dropFile(fileName);
  }
  return { table, fileId: input.fileId, sheet: sheet.name, headerMap, rows };
}
