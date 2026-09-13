/**
 * Row-per-line Tally reports (SPEC §16): Day Book, Ledger Vouchers, Sales and Purchase
 * Registers, Bills Receivable/Payable, Stock Summary, pay sheets.
 *
 * Voucher reports print the date, type and number on a voucher's first line only; following
 * lines carry them forward. Amount sides come from Debit/Credit columns or Dr/Cr suffixes.
 */

import {
  cellAsDate,
  cellAt,
  isBlankRow,
  parseAmount,
  type HeaderDetection,
  type SheetGrid,
} from "@magicmis/ingest";

import { assignRoles } from "./columns";

const TOTAL_RE =
  /^(?:grand\s+)?(?:sub[\s-]?)?total\b|^opening\s+balance\b|^closing\s+balance\b|^current\s+total\b/iu;

function amountAt(sheet: SheetGrid, r: number, col: number | undefined): bigint | null {
  if (col === undefined) return null;
  const c = cellAt(sheet, r, col);
  if (c.text.trim() === "" && typeof c.value !== "number") return null;
  const p = parseAmount(typeof c.value === "number" ? c.value : c.text);
  if (p === null) return null;
  return p.side === "cr" ? -p.paise : p.paise;
}

const textAt = (sheet: SheetGrid, r: number, col: number | undefined): string =>
  col === undefined ? "" : cellAt(sheet, r, col).text.trim();

export interface VoucherLine {
  readonly sourceRow: number;
  readonly date: string | null;
  readonly vchType: string;
  readonly vchNo: string;
  readonly particulars: string;
  /** Debit positive, credit negative; `null` when the line carries no amount. */
  readonly amount: bigint | null;
  readonly gstin: string | null;
  readonly taxable: bigint | null;
  readonly cgst: bigint | null;
  readonly sgst: bigint | null;
  readonly igst: bigint | null;
}

export interface VoucherReport {
  readonly period: HeaderDetection["period"];
  readonly lines: readonly VoucherLine[];
  readonly totals: readonly { sourceRow: number; label: string; amount: bigint | null }[];
}

export function parseVoucherReport(
  sheet: SheetGrid,
  header: HeaderDetection,
): VoucherReport {
  const roles = assignRoles(header.headers);
  const lines: VoucherLine[] = [];
  const totals: VoucherReport["totals"][number][] = [];
  let date: string | null = null;
  let vchType = "";
  let vchNo = "";

  for (let r = header.bodyStart; r < sheet.rows.length; r += 1) {
    if (isBlankRow(sheet.rows[r])) continue;
    const particulars = textAt(sheet, r, roles.particulars);
    const debit = amountAt(sheet, r, roles.debit);
    const credit = amountAt(sheet, r, roles.credit);
    const value = amountAt(sheet, r, roles.value);
    const amount =
      debit !== null || credit !== null
        ? (debit ?? 0n) - (credit === null ? 0n : credit < 0n ? -credit : credit)
        : value;

    if (TOTAL_RE.test(particulars)) {
      totals.push({ sourceRow: r + 1, label: particulars, amount });
      continue;
    }
    const dateCell =
      roles.date === undefined ? null : cellAsDate(cellAt(sheet, r, roles.date));
    const typeText = textAt(sheet, r, roles.vch_type);
    const noText = textAt(sheet, r, roles.vch_no);
    if (dateCell !== null || typeText !== "" || noText !== "") {
      // A new voucher starts when any identifying field is present.
      if (dateCell !== null) date = dateCell;
      vchType = typeText;
      vchNo = noText;
    }
    lines.push({
      sourceRow: r + 1,
      date,
      vchType,
      vchNo,
      particulars,
      amount,
      gstin: textAt(sheet, r, roles.gstin) || null,
      taxable: amountAt(sheet, r, roles.taxable),
      cgst: amountAt(sheet, r, roles.cgst),
      sgst: amountAt(sheet, r, roles.sgst),
      igst: amountAt(sheet, r, roles.igst),
    });
  }
  return { period: header.period, lines, totals };
}

export interface BillLine {
  readonly sourceRow: number;
  readonly party: string;
  readonly billDate: string | null;
  readonly refNo: string;
  /** Signed by Dr/Cr suffix when present; otherwise the magnitude as printed. */
  readonly pending: bigint | null;
  readonly dueOn: string | null;
  readonly overdueDays: number | null;
}

/**
 * Bills outstanding. Tally groups bills under a party heading row (a party name with no bill
 * reference); a party column, when present, is used directly.
 */
export function parseBills(
  sheet: SheetGrid,
  header: HeaderDetection,
): { period: HeaderDetection["period"]; asAt: string | null; bills: BillLine[] } {
  const roles = assignRoles(header.headers);
  const bills: BillLine[] = [];
  let party = "";
  for (let r = header.bodyStart; r < sheet.rows.length; r += 1) {
    if (isBlankRow(sheet.rows[r])) continue;
    const name = textAt(sheet, r, roles.particulars);
    const ref = textAt(sheet, r, roles.ref_no);
    const pending = amountAt(sheet, r, roles.pending);
    if (TOTAL_RE.test(name) || TOTAL_RE.test(ref)) continue;
    if (ref === "" && name !== "") {
      party = name;
      continue;
    }
    if (ref === "") continue;
    const overdue = textAt(sheet, r, roles.overdue_days);
    bills.push({
      sourceRow: r + 1,
      party:
        roles.particulars !== undefined &&
        name !== "" &&
        roles.ref_no !== undefined &&
        name !== party
          ? name
          : party,
      billDate:
        roles.date === undefined ? null : cellAsDate(cellAt(sheet, r, roles.date)),
      refNo: ref,
      pending,
      dueOn:
        roles.due_on === undefined ? null : cellAsDate(cellAt(sheet, r, roles.due_on)),
      overdueDays: /^-?\d+$/u.test(overdue) ? Number.parseInt(overdue, 10) : null,
    });
  }
  return { period: header.period, asAt: header.asAt, bills };
}

export interface StockLine {
  readonly sourceRow: number;
  readonly item: string;
  readonly quantity: string;
  readonly rate: bigint | null;
  readonly value: bigint | null;
}

export function parseStockSummary(
  sheet: SheetGrid,
  header: HeaderDetection,
): { period: HeaderDetection["period"]; items: StockLine[]; total: bigint | null } {
  const roles = assignRoles(header.headers);
  // Prefer closing value/quantity columns when the summary shows opening/inwards/outwards too.
  const pick = (role: "quantity" | "rate" | "value"): number | undefined => {
    const closing = header.headers.findIndex(
      (h) =>
        /closing/iu.test(h) &&
        new RegExp(role === "quantity" ? "quantity|qty" : role, "iu").test(h),
    );
    return closing >= 0 ? closing : roles[role];
  };
  const qCol = pick("quantity");
  const rCol = pick("rate");
  const vCol = pick("value");
  const items: StockLine[] = [];
  let total: bigint | null = null;
  for (let r = header.bodyStart; r < sheet.rows.length; r += 1) {
    if (isBlankRow(sheet.rows[r])) continue;
    const item = textAt(sheet, r, roles.particulars);
    if (TOTAL_RE.test(item)) {
      total = amountAt(sheet, r, vCol);
      continue;
    }
    items.push({
      sourceRow: r + 1,
      item,
      quantity: textAt(sheet, r, qCol),
      rate: amountAt(sheet, r, rCol),
      value: amountAt(sheet, r, vCol),
    });
  }
  return { period: header.period, items, total };
}

export interface PayLine {
  readonly sourceRow: number;
  readonly employee: string;
  readonly designation: string;
  readonly components: Readonly<Record<string, bigint>>;
  readonly gross: bigint | null;
  readonly net: bigint | null;
}

export function parsePaySheet(
  sheet: SheetGrid,
  header: HeaderDetection,
): { period: HeaderDetection["period"]; lines: PayLine[] } {
  const roles = assignRoles(header.headers);
  const known = new Set(Object.values(roles));
  const componentCols = header.headers
    .map((h, i) => ({ h, i }))
    .filter((c) => !known.has(c.i));
  const lines: PayLine[] = [];
  for (let r = header.bodyStart; r < sheet.rows.length; r += 1) {
    if (isBlankRow(sheet.rows[r])) continue;
    const employee = textAt(sheet, r, roles.employee ?? roles.particulars);
    if (employee === "" || TOTAL_RE.test(employee)) continue;
    const components: Record<string, bigint> = {};
    for (const c of componentCols) {
      const a = amountAt(sheet, r, c.i);
      if (a !== null) components[c.h] = a;
    }
    lines.push({
      sourceRow: r + 1,
      employee,
      designation: textAt(sheet, r, roles.designation),
      components,
      gross: amountAt(sheet, r, roles.gross_pay),
      net: amountAt(sheet, r, roles.net_pay),
    });
  }
  return { period: header.period, lines };
}
