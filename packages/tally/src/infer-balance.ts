/**
 * Reading a balance list whose headings say too little (ADR 0031).
 *
 * Exports from systems other than Tally — and hand-made trial balances — often head their
 * columns "Account" and "Amount", or nothing at all. Header vocabulary alone then finds no
 * roles and the sheet used to be refused. The columns' contents say more: a mostly-text column
 * is the ledger name, and a pair of amount columns where each row fills one side or the other
 * is debit and credit.
 *
 * Content decides roles only where the headers did not; a heading that names a role always
 * wins. And a sheet is taken as a trial balance on content alone only when its balances net to
 * zero, which is what makes a trial balance a trial balance — a notes page with a column of
 * numbers does not.
 */

import {
  cellAt,
  parseAmount,
  type ColumnProfile,
  type HeaderDetection,
  type SheetGrid,
} from "@magicmis/ingest";

import { parseBalanceReport, type BalanceReport } from "./balances";
import { assignRoles, type ColumnRole, type RoleMap } from "./columns";

const AMOUNT_ROLES: readonly ColumnRole[] = [
  "opening_dr",
  "opening_cr",
  "opening",
  "debit",
  "credit",
  "closing_dr",
  "closing_cr",
  "closing",
];

const nonZero = (sheet: SheetGrid, r: number, c: number): boolean => {
  const cell = cellAt(sheet, r, c);
  const parsed = parseAmount(typeof cell.value === "number" ? cell.value : cell.text);
  return parsed !== null && parsed.paise !== 0n;
};

/** Share of rows with an amount that fill exactly one of the two columns. */
function exclusivity(sheet: SheetGrid, bodyStart: number, a: number, b: number): number {
  let either = 0;
  let one = 0;
  for (let r = bodyStart; r < sheet.rows.length; r += 1) {
    const x = nonZero(sheet, r, a);
    const y = nonZero(sheet, r, b);
    if (x || y) either += 1;
    if (x !== y) one += 1;
  }
  return either === 0 ? 0 : one / either;
}

export function balanceRoles(
  sheet: SheetGrid,
  header: HeaderDetection,
  columns: readonly ColumnProfile[],
): RoleMap | null {
  const roles: RoleMap = { ...assignRoles(header.headers) };
  const hasAmount = () => AMOUNT_ROLES.some((r) => roles[r] !== undefined);

  // "Amount" or "Value" in a list with no quantity is the balance.
  if (!hasAmount() && roles.value !== undefined && roles.quantity === undefined) {
    roles.closing = roles.value;
    delete roles.value;
  }

  const taken = new Set(Object.values(roles));
  if (!hasAmount()) {
    const amounts = columns
      .filter((c) => (c.type === "amount" || c.type === "integer") && !taken.has(c.index))
      .map((c) => c.index);
    if (amounts.length === 0) return null;
    let pair: [number, number] | null = null;
    for (let i = amounts.length - 1; i > 0 && pair === null; i -= 1) {
      const a = amounts[i - 1];
      const b = amounts[i];
      if (
        a !== undefined &&
        b !== undefined &&
        exclusivity(sheet, header.bodyStart, a, b) >= 0.9
      )
        pair = [a, b];
    }
    if (pair !== null) {
      roles.closing_dr = pair[0];
      roles.closing_cr = pair[1];
    } else {
      const last = amounts.at(-1);
      if (last !== undefined) roles.closing = last;
    }
  }

  if (roles.particulars === undefined) {
    const used = new Set(Object.values(roles));
    const text = columns
      .filter((c) => c.type === "text" && !used.has(c.index))
      .sort((a, b) => b.nonBlank - a.nonBlank || a.index - b.index)[0];
    if (text === undefined) return null;
    roles.particulars = text.index;
  }
  return roles;
}

/** Ledger balances that sum to zero within a small rounding allowance. */
export function netsToZero(report: BalanceReport): boolean {
  const closings = report.ledgers
    .map((l) => l.amounts.closing)
    .filter((v): v is bigint => v !== undefined);
  if (closings.length < 2) return false;
  let sum = 0n;
  let gross = 0n;
  for (const v of closings) {
    sum += v;
    gross += v < 0n ? -v : v;
  }
  if (gross === 0n) return false;
  const allowance = gross / 1000n > 100n ? gross / 1000n : 100n;
  return (sum < 0n ? -sum : sum) <= allowance;
}

/** A balance list read by content, and whether it balances. Null when it has no shape at all. */
export function inferBalanceReport(
  sheet: SheetGrid,
  header: HeaderDetection,
  columns: readonly ColumnProfile[],
): { report: BalanceReport; roles: RoleMap; balanced: boolean } | null {
  const roles = balanceRoles(sheet, header, columns);
  if (roles === null) return null;
  const report = parseBalanceReport(sheet, header, roles);
  if (report.ledgers.length === 0) return null;
  return { report, roles, balanced: netsToZero(report) };
}
