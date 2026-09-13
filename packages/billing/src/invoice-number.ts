/**
 * Gapless invoice numbering per financial year and series (SPEC §13, CGST Rule 46(b)).
 *
 * Rule 46(b): a consecutive serial number "not exceeding sixteen characters, in one or
 * multiple series, containing alphabets or numerals or special characters hyphen or dash
 * and slash", unique for a financial year.
 * https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule46_v1.00.html
 *
 * The SPEC's example `INV/2026-27/000123` is 18 characters, so the default format uses the
 * short FY label: `INV/26-27/000123` (ADR 0013).
 */

import {
  istCalendarDate,
  periodId,
  financialYearOf,
  type FinancialYear,
} from "@magicmis/core/time";
import type { PoolClient } from "pg";

export const RULE_46_PATTERN = /^[A-Za-z0-9/-]{1,16}$/u;

export class InvoiceNumberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceNumberError";
  }
}

/** GST financial years run April–March regardless of any company's MIS FY setting. */
const GST_FY_START_MONTH = 4;

export function gstFinancialYear(instant: Date): FinancialYear {
  const d = istCalendarDate(instant);
  return financialYearOf(periodId(d.year, d.month), GST_FY_START_MONTH);
}

/** "2026-27" — the key the counter and invoice rows are stored under. */
export function fyLabel(fy: FinancialYear): string {
  return `${fy.startYear.toString()}-${((fy.startYear + 1) % 100).toString().padStart(2, "0")}`;
}

/** "26-27". */
export function fyShortLabel(fy: FinancialYear): string {
  const start = (fy.startYear % 100).toString().padStart(2, "0");
  const end = ((fy.startYear + 1) % 100).toString().padStart(2, "0");
  return `${start}-${end}`;
}

const TOKEN = /\{(series|fy|fy_short|seq(?::(\d{1,2}))?)\}/gu;

/**
 * Render a configured format. Tokens: `{series}`, `{fy}` (2026-27), `{fy_short}` (26-27),
 * `{seq}` or `{seq:N}` zero-padded to N. The result must satisfy Rule 46; an admin edit
 * that produces a non-compliant number fails the issue, never silently truncates.
 */
export function formatInvoiceNumber(
  format: string,
  input: { series: string; fy: FinancialYear; seq: bigint },
): string {
  if (!format.includes("{seq"))
    throw new InvoiceNumberError("invoice number format has no {seq} token");
  if (input.seq <= 0n) throw new InvoiceNumberError("invoice sequence must be positive");
  const rendered = format.replace(
    TOKEN,
    (_match, token: string, width: string | undefined) => {
      if (token === "series") return input.series;
      if (token === "fy") return fyLabel(input.fy);
      if (token === "fy_short") return fyShortLabel(input.fy);
      const digits = input.seq.toString();
      return width === undefined
        ? digits
        : digits.padStart(Number.parseInt(width, 10), "0");
    },
  );
  if (!RULE_46_PATTERN.test(rendered)) {
    throw new InvoiceNumberError(
      `invoice number "${rendered}" breaks CGST Rule 46(b): at most 16 letters, digits, "-" or "/"`,
    );
  }
  return rendered;
}

/**
 * Take the next number. Must run in the same transaction as the invoice insert: the
 * counter row stays locked until commit, and a rollback returns the number, so no gap.
 */
export async function nextInvoiceSequence(
  tx: PoolClient,
  input: { financialYear: string; series: string },
): Promise<bigint> {
  await tx.query(
    `insert into public.invoice_counters (financial_year, series, last_number)
     values ($1, $2, 0) on conflict (financial_year, series) do nothing`,
    [input.financialYear, input.series],
  );
  const r = await tx.query<{ last_number: string }>(
    `update public.invoice_counters set last_number = last_number + 1
     where financial_year = $1 and series = $2
     returning last_number::text as last_number`,
    [input.financialYear, input.series],
  );
  const n = r.rows[0]?.last_number;
  if (n === undefined) throw new Error("nextInvoiceSequence: counter row missing");
  return BigInt(n);
}
