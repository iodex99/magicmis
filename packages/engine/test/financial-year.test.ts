/**
 * ADR 0035: an export whose financial year differs from the company's is found from the balances
 * themselves, because nothing else on the screen says so until a month's revenue comes out as the
 * whole year with a minus sign.
 */

import type { PeriodId } from "@magicmis/core/time";
import { describe, expect, it } from "vitest";

import { detectSourceFinancialYear } from "../src/financial-year";
import type { LedgerFact } from "../src/facts";

const fact = (period: string, closing: bigint, pl = true): LedgerFact => ({
  ledgerKey: pl ? "sales" : "cash",
  name: pl ? "Sales" : "Cash",
  groupPath: [pl ? "Sales Accounts" : "Bank Accounts"],
  period: period as PeriodId,
  opening: null,
  debit: null,
  credit: null,
  closing,
  source: { fileId: "tb.xlsx", sheet: "TB", sourceRow: 1 },
});

const isPl = (f: LedgerFact) => f.ledgerKey === "sales";

/** A cumulative P&L series that resets each April, as a Tally export writes it. */
const aprilYear = (months: number): LedgerFact[] => {
  const out: LedgerFact[] = [];
  let running = 0n;
  for (let i = 0; i < months; i += 1) {
    const month = ((3 + i) % 12) + 1;
    const year = 2025 + Math.floor((3 + i) / 12);
    if (month === 4) running = 0n;
    running += 1_000_000n;
    out.push(fact(`${year.toString()}-${month.toString().padStart(2, "0")}`, running));
  }
  return out;
};

describe("the year the exports actually run on", () => {
  it("finds the reset month in a cumulative export", () => {
    expect(detectSourceFinancialYear(aprilYear(18), isPl)).toEqual({
      startMonth: 4,
      resets: 1,
    });
  });

  it("finds it again over two years, and counts both resets", () => {
    expect(detectSourceFinancialYear(aprilYear(30), isPl)).toEqual({
      startMonth: 4,
      resets: 2,
    });
  });

  it("says nothing when each month stands alone", () => {
    // Movement-style exports rise and fall with trade; a quiet month is not a year boundary.
    const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
    const amounts = [900_000n, 400_000n, 950_000n, 300_000n, 800_000n, 350_000n];
    const facts = months.map((m, i) => fact(m, amounts[i] ?? 0n));
    expect(detectSourceFinancialYear(facts, isPl)).toBeNull();
  });

  it("says nothing from too few months, or with no P&L ledgers at all", () => {
    expect(detectSourceFinancialYear(aprilYear(3), isPl)).toBeNull();
    expect(detectSourceFinancialYear(aprilYear(18), () => false)).toBeNull();
  });

  it("ignores balance-sheet ledgers, which never reset", () => {
    const withBalanceSheet = [
      ...aprilYear(18),
      ...aprilYear(18).map((f) => ({ ...f, ledgerKey: "cash", name: "Cash" })),
    ];
    expect(detectSourceFinancialYear(withBalanceSheet, isPl)).toEqual({
      startMonth: 4,
      resets: 1,
    });
  });
});
