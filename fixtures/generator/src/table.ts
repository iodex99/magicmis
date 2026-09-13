/**
 * A report as rows of typed cells, and writers to xlsx (SheetJS) and csv.
 *
 * Amounts are integer paise. In xlsx they are numbers with a number format unless a variant
 * asks for text (e.g. Dr/Cr suffixes); in csv they are text in the variant's grouping.
 */

import * as XLSX from "xlsx";

export type Grouping = "indian" | "international" | "plain";

export type Out =
  | null
  | string
  | { readonly amount: bigint; readonly side?: "dr" | "cr"; readonly text?: boolean }
  | { readonly date: string };

export interface Table {
  readonly sheetName: string;
  readonly rows: readonly (readonly Out[])[];
  readonly merges?: readonly { r: number; c: number; r2: number; c2: number }[];
  readonly grouping: Grouping;
}

function groupDigits(digits: string, grouping: Grouping): string {
  if (grouping === "plain") return digits;
  if (grouping === "international") return digits.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/gu, ",")},${digits.slice(-3)}`;
}

export function formatAmount(
  paise: bigint,
  grouping: Grouping,
  side?: "dr" | "cr",
): string {
  const neg = paise < 0n;
  const abs = (neg ? -paise : paise).toString().padStart(3, "0");
  const body = `${groupDigits(abs.slice(0, -2), grouping)}.${abs.slice(-2)}`;
  const signed = neg && side === undefined ? `-${body}` : body;
  return side === undefined ? signed : `${signed} ${side === "dr" ? "Dr" : "Cr"}`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Tally's display form: `1-Apr-25`. */
export function tallyDate(iso: string): string {
  const [y = "", m = "", d = ""] = iso.split("-");
  return `${Number.parseInt(d, 10).toString()}-${MONTHS[Number.parseInt(m, 10) - 1] ?? ""}-${y.slice(2)}`;
}

function excelSerial(iso: string): number {
  const [y = 0, m = 1, d = 1] = iso.split("-").map((p) => Number.parseInt(p, 10));
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

/** Paise to a JS number of rupees for an xlsx numeric cell. Exact for ≤ 2^53 paise / 100. */
function rupeesNumber(paise: bigint): number {
  const neg = paise < 0n;
  const abs = neg ? -paise : paise;
  const s = `${(abs / 100n).toString()}.${(abs % 100n).toString().padStart(2, "0")}`;
  const n = Number.parseFloat(s);
  return neg ? -n : n;
}

export function toCsv(table: Table): Uint8Array {
  const esc = (s: string) => (/[",\n\r]/u.test(s) ? `"${s.replace(/"/gu, '""')}"` : s);
  const lines = table.rows.map((row) =>
    row
      .map((c) => {
        if (c === null) return "";
        if (typeof c === "string") return esc(c);
        if ("date" in c) return esc(tallyDate(c.date));
        return esc(formatAmount(c.amount, table.grouping, c.side));
      })
      .join(","),
  );
  return new TextEncoder().encode(lines.join("\r\n") + "\r\n");
}

export function toXlsx(tables: readonly Table[]): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const table of tables) {
    const aoa = table.rows.map((row) =>
      row.map((c): XLSX.CellObject | null => {
        if (c === null) return null;
        if (typeof c === "string") return { t: "s", v: c };
        if ("date" in c) return { t: "n", v: excelSerial(c.date), z: "d-mmm-yy" };
        if (c.text === true || c.side !== undefined)
          return { t: "s", v: formatAmount(c.amount, table.grouping, c.side) };
        return { t: "n", v: rupeesNumber(c.amount), z: "#,##0.00" };
      }),
    );
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    if (table.merges)
      ws["!merges"] = table.merges.map((m) => ({
        s: { r: m.r, c: m.c },
        e: { r: m.r2, c: m.c2 },
      }));
    XLSX.utils.book_append_sheet(wb, ws, table.sheetName.slice(0, 31));
  }
  return new Uint8Array(
    XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer,
  );
}
