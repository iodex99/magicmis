/**
 * Facts: the normalised rows the engine computes from (SPEC §20). Parsed Tally reports become
 * ledger × period balances with source references, so every number traces back to a file,
 * sheet and row. Amounts are integer paise, debit positive.
 */

import type { PeriodId } from "@magicmis/core/time";
import type { BalanceReport } from "@magicmis/tally";
import { ledgerKey } from "@magicmis/semantic";

export interface SourceRef {
  readonly fileId: string;
  readonly sheet: string;
  readonly sourceRow: number;
}

export interface LedgerFact {
  readonly ledgerKey: string;
  readonly name: string;
  readonly groupPath: readonly string[];
  readonly period: PeriodId;
  /** Balance-sheet style amounts as reported. Opening/debit/credit are null when the export omits them. */
  readonly opening: bigint | null;
  readonly debit: bigint | null;
  readonly credit: bigint | null;
  readonly closing: bigint;
  readonly source: SourceRef;
}

export class FactsError extends Error {
  constructor(
    readonly code: "no_period" | "multi_month_period" | "missing_closing",
    message: string,
  ) {
    super(message);
    this.name = "FactsError";
  }
}

const periodOfIso = (iso: string): PeriodId => iso.slice(0, 7) as PeriodId;

/**
 * Ledger facts from one trial balance or group summary. The report's period end decides the
 * fact period; P&L movement for the month is derived later from closings within the FY.
 */
export function ledgerFactsFromReport(
  report: BalanceReport,
  input: { fileId: string; sheet: string; period?: PeriodId },
): LedgerFact[] {
  const end = report.period?.to ?? report.asAt;
  const period = input.period ?? (end === null ? null : periodOfIso(end));
  if (period === null)
    throw new FactsError("no_period", "The report does not state its period");

  // Tally leaves zero cells blank: within a column the report has, a blank is zero, not unknown.
  const has = (field: "opening" | "debit" | "credit") =>
    report.ledgers.some((l) => l.amounts[field] !== undefined);
  const present = { opening: has("opening"), debit: has("debit"), credit: has("credit") };
  const amount = (value: bigint | undefined, field: "opening" | "debit" | "credit") =>
    value ?? (present[field] ? 0n : null);

  return report.ledgers.map((l) => {
    const groupPath = l.path.slice(0, -1);
    const closing =
      l.amounts.closing ??
      closingFrom(l.amounts) ??
      (report.ledgers.some((x) => x.amounts.closing !== undefined) ? 0n : null);
    if (closing === null) {
      throw new FactsError(
        "missing_closing",
        `No closing balance at row ${l.sourceRow.toString()}`,
      );
    }
    return {
      ledgerKey: ledgerKey({ groupPath, name: l.name }),
      name: l.name,
      groupPath,
      period,
      opening: amount(l.amounts.opening, "opening"),
      debit: amount(l.amounts.debit, "debit"),
      credit: amount(l.amounts.credit, "credit"),
      closing,
      source: { fileId: input.fileId, sheet: input.sheet, sourceRow: l.sourceRow },
    };
  });
}

function closingFrom(a: BalanceReport["ledgers"][number]["amounts"]): bigint | null {
  if (a.opening === undefined && a.debit === undefined && a.credit === undefined)
    return null;
  return (a.opening ?? 0n) + (a.debit ?? 0n) - (a.credit ?? 0n);
}

export interface TxnFact {
  readonly date: string;
  readonly period: PeriodId;
  readonly voucherType: string;
  readonly voucherNo: string;
  readonly ledger: string;
  readonly party: string | null;
  /** Debit positive. */
  readonly amount: bigint;
  readonly source: SourceRef;
}
