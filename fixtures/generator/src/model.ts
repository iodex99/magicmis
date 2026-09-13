/**
 * Synthetic books model (SPEC §16). Everything is fictional and generated from a seed; no real
 * company, person or identifier is used (SPEC §0.8). Amounts are integer paise, debit positive.
 */

export type Nature = "asset" | "liability" | "income" | "expense";

export interface GroupDef {
  readonly name: string;
  /** Parent group name; null for Tally primary groups. */
  readonly parent: string | null;
  readonly nature: Nature;
}

export interface LedgerDef {
  readonly id: string;
  readonly name: string;
  readonly group: string;
  /** Opening balance at the start of the books, debit positive. */
  readonly opening: bigint;
  readonly stateCode?: string;
  readonly gstin?: string;
}

export interface Entry {
  readonly ledger: string; // ledger id
  readonly amount: bigint; // debit positive, credit negative
}

export interface Voucher {
  readonly date: string; // ISO
  readonly type: "Sales" | "Purchase" | "Receipt" | "Payment" | "Journal" | "Contra";
  readonly number: string;
  readonly narration: string;
  readonly entries: readonly Entry[];
  readonly party?: string; // ledger id
  readonly billRef?: string;
  readonly dueDate?: string;
  readonly taxable?: bigint;
  readonly cgst?: bigint;
  readonly sgst?: bigint;
  readonly igst?: bigint;
  /** Bill references settled by a receipt/payment. */
  readonly settles?: readonly string[];
}

export interface Bill {
  readonly party: string; // ledger id
  readonly ref: string;
  readonly date: string;
  readonly dueDate: string;
  /** Positive magnitude. */
  readonly amount: bigint;
  readonly side: "receivable" | "payable";
  settledOn: string | null;
}

export interface StockItem {
  readonly name: string;
  readonly unit: string;
  readonly rate: bigint; // paise per unit
}

export interface Employee {
  readonly code: string;
  readonly name: string;
  readonly designation: string;
  readonly basic: bigint;
  readonly hra: bigint;
}

export type CompanyKind = "trading" | "services" | "manufacturing";

export interface CompanySpec {
  readonly id: string;
  readonly kind: CompanyKind;
  readonly name: string;
  readonly address: string;
  readonly stateCode: string;
  readonly booksStart: string; // ISO, first day of FY
  readonly months: number;
  readonly groups: readonly GroupDef[];
  readonly ledgers: readonly LedgerDef[];
  readonly items: readonly StockItem[];
  readonly employees: readonly Employee[];
  readonly seed: number;
}

/** Mulberry32: small, fast, deterministic. Not for security. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rand: () => number, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

/** A random whole-rupee amount in paise. */
export function randRupees(
  rand: () => number,
  minRupees: number,
  maxRupees: number,
): bigint {
  return BigInt(randInt(rand, minRupees, maxRupees)) * 100n;
}

export function pick<T>(rand: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rand() * items.length)];
  if (item === undefined) throw new Error("pick from empty list");
  return item;
}

export const monthKey = (iso: string): string => iso.slice(0, 7);

export function addMonths(isoMonth: string, n: number): string {
  const [y = 0, m = 1] = isoMonth.split("-").map((p) => Number.parseInt(p, 10));
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12).toString()}-${((total % 12) + 1).toString().padStart(2, "0")}`;
}

export function daysInMonth(isoMonth: string): number {
  const [y = 0, m = 1] = isoMonth.split("-").map((p) => Number.parseInt(p, 10));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export const dayOf = (isoMonth: string, day: number): string =>
  `${isoMonth}-${day.toString().padStart(2, "0")}`;

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** GST at 18%, half each for CGST/SGST, rounded half-up per levy (as ADR 0013). */
export function gst18(
  taxable: bigint,
  intraState: boolean,
): { cgst: bigint; sgst: bigint; igst: bigint } {
  const half = (taxable * 9n + 50n) / 100n;
  if (intraState) return { cgst: half, sgst: half, igst: 0n };
  return { cgst: 0n, sgst: 0n, igst: (taxable * 18n + 50n) / 100n };
}
