/**
 * Monthly accounting exports for admins (SPEC §13): credits sold, consumed, expired,
 * outstanding liability, GST summary and invoice register. Months are IST calendar months.
 */

import {
  fromIstParts,
  parsePeriodId,
  periodParts,
  addMonths,
  type PeriodId,
} from "@magicmis/core/time";
import type { Queryable } from "@magicmis/db/tx";

export type AccountingReport =
  | "credits_sold"
  | "credits_consumed"
  | "credits_expired"
  | "outstanding_credits"
  | "gst_summary"
  | "invoice_register";

export const ACCOUNTING_REPORTS: readonly AccountingReport[] = [
  "credits_sold",
  "credits_consumed",
  "credits_expired",
  "outstanding_credits",
  "gst_summary",
  "invoice_register",
];

/** RFC 4180 quoting, plus a leading apostrophe on cells a spreadsheet would run as a formula. */
export function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
  return /[",\r\n]/u.test(guarded) ? `"${guarded.replace(/"/gu, '""')}"` : guarded;
}

export function toCsv(
  header: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Paise as a plain rupee decimal for spreadsheets: 236000 → "2360.00". */
/**
 * Integer minor units as a plain decimal for a CSV cell: 236000 -> "2360.00".
 *
 * Currency-agnostic, and named that way since the product bills in two (ADR 0030). The
 * currency belongs in its own column rather than glued to the number, so a spreadsheet
 * can still sum the column.
 */
export function minorCell(p: string | bigint): string {
  const v = typeof p === "bigint" ? p : BigInt(p);
  const neg = v < 0n;
  const abs = (neg ? -v : v).toString().padStart(3, "0");
  return `${neg ? "-" : ""}${abs.slice(0, -2)}.${abs.slice(-2)}`;
}

export function istMonthRange(period: PeriodId): { from: Date; to: Date } {
  const start = periodParts(period);
  const next = periodParts(addMonths(period, 1));
  return {
    from: fromIstParts({
      year: start.year,
      month: start.month,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
    }),
    to: fromIstParts({
      year: next.year,
      month: next.month,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
    }),
  };
}

export async function accountingCsv(
  db: Queryable,
  report: AccountingReport,
  month: string,
): Promise<string> {
  const period = parsePeriodId(month);
  if (period === null) throw new RangeError(`accountingCsv: "${month}" is not YYYY-MM`);
  const { from, to } = istMonthRange(period);

  switch (report) {
    case "credits_sold": {
      const r = await db.query<{
        credited_at: string;
        purchase_id: string;
        account_id: string;
        method: string;
        invoice_number: string | null;
        credits: string;
        bonus_credits: string;
        currency: string;
        taxable: string;
        gst: string;
        total: string;
      }>(
        `select to_char(p.credited_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as credited_at,
                p.id as purchase_id, p.account_id, p.method, i.number as invoice_number,
                p.credits::text as credits, p.bonus_credits::text as bonus_credits,
                p.currency,
                p.amount_minor_ex_tax::text as taxable, p.tax_minor::text as gst,
                p.total_minor::text as total
         from public.purchases p
         left join public.invoices i on i.purchase_id = p.id and i.type = 'tax_invoice'
         where p.status = 'credited' and p.credited_at >= $1 and p.credited_at < $2
         order by p.credited_at, p.id`,
        [from, to],
      );
      return toCsv(
        [
          "credited_date_ist",
          "purchase_id",
          "account_id",
          "method",
          "invoice_number",
          "credits",
          "bonus_credits",
          "currency",
          "value_ex_tax",
          "tax",
          "total",
        ],
        r.rows.map((x) => [
          x.credited_at,
          x.purchase_id,
          x.account_id,
          x.method,
          x.invoice_number ?? "",
          x.credits,
          x.bonus_credits,
          x.currency,
          minorCell(x.taxable),
          minorCell(x.gst),
          minorCell(x.total),
        ]),
      );
    }
    case "credits_consumed":
    case "credits_expired": {
      const type = report === "credits_consumed" ? "capture" : "expire";
      const r = await db.query<{ account_id: string; entries: string; credits: string }>(
        `select account_id, count(*)::text as entries, sum(amount)::text as credits
         from public.credit_ledger
         where entry_type = $1 and created_at >= $2 and created_at < $3
         group by account_id order by account_id`,
        [type, from, to],
      );
      return toCsv(
        ["account_id", "entries", "credits"],
        r.rows.map((x) => [x.account_id, x.entries, x.credits]),
      );
    }
    case "outstanding_credits": {
      // The liability at month end: each account's last ledger balance before the cut-off.
      // Lots are expired at the next wallet operation or the nightly sweep, so a lot due in
      // the last hours of the month may still be counted; the expiry lands next month.
      const r = await db.query<{ account_id: string; balance: string; held: string }>(
        `select distinct on (account_id) account_id, balance_after::text as balance, held_after::text as held
         from public.credit_ledger where created_at < $1
         order by account_id, seq desc`,
        [to],
      );
      const rows = r.rows.filter((x) => x.balance !== "0");
      const total = rows.reduce((s, x) => s + BigInt(x.balance), 0n);
      return toCsv(
        ["account_id", "outstanding_credits", "held_credits"],
        [
          ...rows.map((x) => [x.account_id, x.balance, x.held]),
          ["TOTAL", total.toString(), ""],
        ],
      );
    }
    case "gst_summary": {
      const r = await db.query<{
        supply: string;
        /** Null on an export row: a supply outside India has no GST state. */
        pos: string | null;
        pos_name: string | null;
        invoices: string;
        currency: string;
        taxable: string;
        cgst: string;
        sgst: string;
        igst: string;
        total: string;
      }>(
        `select totals->>'supply' as supply, currency, place_of_supply_state_code as pos,
                max(place_of_supply_state_name) as pos_name, count(*)::text as invoices,
                sum((totals->>'taxable_minor')::bigint)::text as taxable,
                sum((totals->>'cgst_minor')::bigint)::text as cgst,
                sum((totals->>'sgst_minor')::bigint)::text as sgst,
                sum((totals->>'igst_minor')::bigint)::text as igst,
                sum((totals->>'total_minor')::bigint)::text as total
         from public.invoices
         where type = 'tax_invoice' and issued_at >= $1 and issued_at < $2
         group by 1, 2, 3 order by 1, 2, 3`,
        [from, to],
      );
      return toCsv(
        [
          "supply",
          "currency",
          "place_of_supply_code",
          "place_of_supply",
          "invoices",
          "taxable",
          "cgst",
          "sgst",
          "igst",
          "total",
        ],
        r.rows.map((x) => [
          x.supply,
          x.currency,
          x.pos ?? "",
          x.pos_name ?? "",
          x.invoices,
          minorCell(x.taxable),
          minorCell(x.cgst),
          minorCell(x.sgst),
          minorCell(x.igst),
          minorCell(x.total),
        ]),
      );
    }
    case "invoice_register": {
      const r = await db.query<{
        number: string;
        type: string;
        issued: string;
        buyer_name: string | null;
        buyer_gstin: string | null;
        pos: string | null;
        currency: string;
        taxable: string;
        cgst: string;
        sgst: string;
        igst: string;
        total: string;
      }>(
        `select number, type, to_char(issued_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as issued,
                buyer->>'name' as buyer_name, buyer_gstin, place_of_supply_state_code as pos,
                currency,
                totals->>'taxable_minor' as taxable, totals->>'cgst_minor' as cgst,
                totals->>'sgst_minor' as sgst, totals->>'igst_minor' as igst, totals->>'total_minor' as total
         from public.invoices
         where issued_at >= $1 and issued_at < $2
         order by type desc, financial_year, number`,
        [from, to],
      );
      return toCsv(
        [
          "invoice_number",
          "type",
          "date_ist",
          "buyer_name",
          "buyer_gstin",
          "place_of_supply_code",
          "currency",
          "taxable",
          "cgst",
          "sgst",
          "igst",
          "total",
        ],
        r.rows.map((x) => [
          x.number,
          x.type,
          x.issued,
          x.buyer_name ?? "",
          x.buyer_gstin ?? "",
          x.pos ?? "",
          x.currency,
          minorCell(x.taxable),
          minorCell(x.cgst),
          minorCell(x.sgst),
          minorCell(x.igst),
          minorCell(x.total),
        ]),
      );
    }
  }
}
