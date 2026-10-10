/**
 * Random books kept the way Tally keeps them (ADR 0086), shared by the property tests that need
 * books whose every trial balance balances: the cash flow in the engine and the statutory
 * statements in the workbook (ADR 0087).
 */

import { addMonths, type PeriodId } from "@magicmis/core/time";
import { ledgerKey } from "@magicmis/semantic";
import fc from "fast-check";

import type { LedgerFact } from "../src/facts";

/** Ledgers in Tally's own groups, so the cascade maps them as it maps real books. */
export const LEDGERS = [
  { name: "Cash", group: "Cash-in-hand", pl: false },
  { name: "Example Bank", group: "Bank Accounts", pl: false },
  { name: "Customer A", group: "Sundry Debtors", pl: false },
  { name: "Closing Stock", group: "Stock-in-hand", pl: false },
  { name: "Advance to staff", group: "Loans & Advances (Asset)", pl: false },
  { name: "Supplier A", group: "Sundry Creditors", pl: false },
  { name: "Output GST", group: "Duties & Taxes", pl: false },
  { name: "Term loan", group: "Secured Loans", pl: false },
  { name: "Furniture", group: "Fixed Assets", pl: false },
  { name: "Mutual fund", group: "Investments", pl: false },
  { name: "Capital", group: "Capital Account", pl: false },
  { name: "Profit & Loss A/c", group: "Profit & Loss A/c", pl: false },
  { name: "Odd balance", group: "Zzqx Holding", pl: false },
  { name: "Sales", group: "Sales Accounts", pl: true },
  { name: "Purchases", group: "Purchase Accounts", pl: true },
  { name: "Rent", group: "Indirect Expenses", pl: true },
  { name: "Depreciation", group: "Indirect Expenses", pl: true },
  { name: "Interest received", group: "Indirect Incomes", pl: true },
] as const;
const PROFIT_AND_LOSS_AC = LEDGERS.findIndex((l) => l.name === "Profit & Loss A/c");

export const posting = fc.record({
  debit: fc.integer({ min: 0, max: LEDGERS.length - 1 }),
  credit: fc.integer({ min: 0, max: LEDGERS.length - 1 }),
  amount: fc.bigInt({ min: 1n, max: 10n ** 9n }),
});

/**
 * Books kept the way Tally keeps them: balance-sheet ledgers carry forward, profit-and-loss
 * ledgers are cumulative within the year and restart in April with the closed year's result moved
 * into the Profit & Loss A/c. Each month's trial balance balances because every posting is a
 * debit and a credit of the same amount.
 */
export function keepBooks(
  openings: readonly bigint[],
  months: readonly (readonly { debit: number; credit: number; amount: bigint }[])[],
  first: PeriodId,
): LedgerFact[] {
  const facts: LedgerFact[] = [];
  const balance = [...openings];
  let period = first;
  for (const postings of months) {
    if (period.endsWith("-04")) {
      const result = LEDGERS.reduce((s, l, i) => (l.pl ? s + (balance[i] ?? 0n) : s), 0n);
      LEDGERS.forEach((l, i) => {
        if (l.pl) balance[i] = 0n;
      });
      balance[PROFIT_AND_LOSS_AC] = (balance[PROFIT_AND_LOSS_AC] ?? 0n) + result;
    }
    const opening = [...balance];
    for (const p of postings) {
      if (p.debit === p.credit) continue;
      balance[p.debit] = (balance[p.debit] ?? 0n) + p.amount;
      balance[p.credit] = (balance[p.credit] ?? 0n) - p.amount;
    }
    LEDGERS.forEach((l, i) => {
      facts.push({
        ledgerKey: ledgerKey({ groupPath: [l.group], name: l.name }),
        name: l.name,
        groupPath: [l.group],
        period,
        opening: opening[i] ?? 0n,
        debit: null,
        credit: null,
        closing: balance[i] ?? 0n,
        source: { fileId: "books", sheet: period, sourceRow: i + 1 },
      });
    });
    period = addMonths(period, 1);
  }
  return facts;
}

/** Openings that balance: everything against capital, and nothing on a profit-and-loss ledger. */
export function balancedOpenings(raw: readonly bigint[]): bigint[] {
  const openings = raw.map((x, i) => (LEDGERS[i]?.pl === true ? 0n : x));
  const capital = LEDGERS.findIndex((l) => l.name === "Capital");
  openings[capital] = -openings.reduce((s, x, i) => (i === capital ? s : s + x), 0n);
  return openings;
}

/** The arbitraries the property tests draw books from. */
export const booksArbitrary = {
  openings: fc.array(fc.bigInt({ min: 0n, max: 10n ** 9n }), {
    minLength: LEDGERS.length,
    maxLength: LEDGERS.length,
  }),
  months: fc.array(fc.array(posting, { maxLength: 12 }), { minLength: 2, maxLength: 7 }),
  first: fc.constantFrom(
    "2025-01",
    "2025-02",
    "2025-03",
    "2025-04",
  ) as fc.Arbitrary<PeriodId>,
};
