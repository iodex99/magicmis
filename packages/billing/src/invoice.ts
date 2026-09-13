/**
 * Tax invoices and proformas (SPEC §13, CGST Rule 46).
 *
 * An invoice row is a snapshot: seller and buyer details, place of supply, SAC, line
 * items and totals are copied in at issue time and the row is immutable (trigger in
 * migration 0007). The PDF is rendered from this row alone, so it can be regenerated
 * byte-for-byte at any time and never drifts from what was issued.
 */

import { GST_STATE_CODES, isGstStateCode } from "@magicmis/core/identifiers";
import { readConfig } from "@magicmis/db/config";
import type { Queryable } from "@magicmis/db/tx";
import type { PoolClient } from "pg";
import { z } from "zod";

import {
  formatInvoiceNumber,
  fyLabel,
  gstFinancialYear,
  nextInvoiceSequence,
} from "./invoice-number";
import { halfRate } from "./gst";
import { amountInWordsIndian } from "./words";

export type InvoiceType = "tax_invoice" | "proforma";

export const sellerSchema = z.object({
  legal_name: z.string().min(1),
  gstin: z.string(),
  state_code: z.string().regex(/^[0-9]{2}$/u),
  address: z.array(z.string()).min(1),
});
export type Seller = z.infer<typeof sellerSchema>;

export const invoiceSeriesSchema = z.object({
  tax_invoice: z.string().regex(/^[A-Za-z0-9-]{1,6}$/u),
  proforma: z.string().regex(/^[A-Za-z0-9-]{1,6}$/u),
});

const billingAddressSchema = z
  .object({
    line1: z.string(),
    line2: z.string().optional(),
    city: z.string(),
    pincode: z.string(),
    stateCode: z.string(),
  })
  .partial();

export const buyerSchema = z.object({
  name: z.string(),
  gstin: z.string().nullable(),
  address: z.array(z.string()),
  state_code: z.string(),
  state_name: z.string(),
});
export type Buyer = z.infer<typeof buyerSchema>;

export const lineItemSchema = z.object({
  description: z.string(),
  sac: z.string(),
  credits: z.string().regex(/^\d+$/u),
  bonus_credits: z.string().regex(/^\d+$/u),
  taxable_paise: z.string().regex(/^\d+$/u),
});

export const totalsSchema = z.object({
  taxable_paise: z.string().regex(/^\d+$/u),
  gst_rate_percent: z.string(),
  supply: z.enum(["intra_state", "inter_state"]),
  cgst_rate_percent: z.string().nullable(),
  sgst_rate_percent: z.string().nullable(),
  igst_rate_percent: z.string().nullable(),
  cgst_paise: z.string().regex(/^\d+$/u),
  sgst_paise: z.string().regex(/^\d+$/u),
  igst_paise: z.string().regex(/^\d+$/u),
  gst_paise: z.string().regex(/^\d+$/u),
  total_paise: z.string().regex(/^\d+$/u),
  total_in_words: z.string(),
  /** Proforma only: pay-by date and bank details. */
  valid_until: z.string().nullable(),
  bank_details: z.record(z.string(), z.string()).nullable(),
});

export interface InvoiceRecord {
  readonly id: string;
  readonly accountId: string;
  readonly purchaseId: string;
  readonly type: InvoiceType;
  readonly number: string;
  readonly financialYear: string;
  readonly series: string;
  readonly seller: Seller;
  readonly buyer: Buyer;
  readonly placeOfSupplyStateCode: string;
  readonly placeOfSupplyStateName: string;
  readonly sacCode: string;
  readonly lineItems: readonly z.infer<typeof lineItemSchema>[];
  readonly totals: z.infer<typeof totalsSchema>;
  readonly issuedAt: Date;
}

export function stateName(code: string): string {
  if (!isGstStateCode(code)) throw new RangeError(`unknown GST state code ${code}`);
  return GST_STATE_CODES[code];
}

const hasPlaceholder = (value: unknown): boolean =>
  JSON.stringify(value).includes("PENDING-REVIEW");

interface PurchaseForInvoice {
  readonly id: string;
  readonly accountId: string;
  readonly amountPaiseExGst: bigint;
  readonly cgstPaise: bigint;
  readonly sgstPaise: bigint;
  readonly igstPaise: bigint;
  readonly gstPaise: bigint;
  readonly totalPaise: bigint;
  readonly credits: bigint;
  readonly bonusCredits: bigint;
  readonly gstRate: string;
  readonly placeOfSupplyStateCode: string;
}

/**
 * Issue an invoice for a purchase inside the caller's transaction. Numbers come from the
 * row-locked counter in this same transaction, so a rollback leaves no gap.
 */
export async function issueInvoice(
  tx: PoolClient,
  input: { purchase: PurchaseForInvoice; type: InvoiceType; now: Date },
): Promise<InvoiceRecord> {
  const { purchase, type, now } = input;
  const seller = await readConfig(tx, "billing.seller", sellerSchema, now);
  const sac = await readConfig(tx, "billing.sac_code", z.string().min(1), now);
  const format = await readConfig(
    tx,
    "billing.invoice_number_format",
    z.string().min(1),
    now,
  );
  const seriesConfig = await readConfig(
    tx,
    "billing.invoice_series",
    invoiceSeriesSchema,
    now,
  );

  const allowPlaceholders = await readConfig(
    tx,
    "billing.allow_placeholder_details",
    z.boolean(),
    now,
  );
  if (
    !allowPlaceholders &&
    (hasPlaceholder(seller) || hasPlaceholder(sac) || seller.gstin === "")
  ) {
    throw new Error(
      "issueInvoice: seller details or SAC code are placeholders (REVIEW_ITEMS R-02, R-03)",
    );
  }

  const account = await tx.query<{
    business_name: string;
    gstin: string | null;
    billing_address: unknown;
  }>(`select business_name, gstin, billing_address from public.accounts where id = $1`, [
    purchase.accountId,
  ]);
  const acc = account.rows[0];
  if (acc === undefined) throw new Error("issueInvoice: account not found");
  const address = billingAddressSchema.safeParse(acc.billing_address);
  const addr = address.success ? address.data : {};
  const pos = purchase.placeOfSupplyStateCode;

  const buyer: Buyer = {
    name: acc.business_name,
    gstin: acc.gstin,
    address: [
      addr.line1,
      addr.line2,
      [addr.city, addr.pincode].filter(Boolean).join(" "),
    ].filter((l): l is string => l !== undefined && l !== ""),
    state_code: pos,
    state_name: stateName(pos),
  };

  const fy = gstFinancialYear(now);
  const series =
    type === "tax_invoice" ? seriesConfig.tax_invoice : seriesConfig.proforma;
  const financialYear = fyLabel(fy);
  const seq = await nextInvoiceSequence(tx, { financialYear, series });
  const number = formatInvoiceNumber(format, { series, fy, seq });

  let validUntil: string | null = null;
  let bankDetails: Record<string, string> | null = null;
  if (type === "proforma") {
    const days = await readConfig(
      tx,
      "billing.proforma_validity_days",
      z.number().int().positive(),
      now,
    );
    validUntil = new Date(now.getTime() + days * 86_400_000).toISOString();
    bankDetails = await readConfig(
      tx,
      "billing.bank_transfer_details",
      z.record(z.string(), z.string()),
      now,
    );
  }

  const intra = purchase.igstPaise === 0n;
  const lineItems = [
    {
      description:
        purchase.bonusCredits > 0n
          ? `Prepaid service credits: ${purchase.credits.toString()} credits + ${purchase.bonusCredits.toString()} bonus credits`
          : `Prepaid service credits: ${purchase.credits.toString()} credits`,
      sac,
      credits: purchase.credits.toString(),
      bonus_credits: purchase.bonusCredits.toString(),
      taxable_paise: purchase.amountPaiseExGst.toString(),
    },
  ];
  const totals: z.infer<typeof totalsSchema> = {
    taxable_paise: purchase.amountPaiseExGst.toString(),
    gst_rate_percent: purchase.gstRate,
    supply: intra ? "intra_state" : "inter_state",
    cgst_rate_percent: intra ? halfRate(purchase.gstRate) : null,
    sgst_rate_percent: intra ? halfRate(purchase.gstRate) : null,
    igst_rate_percent: intra ? null : purchase.gstRate,
    cgst_paise: purchase.cgstPaise.toString(),
    sgst_paise: purchase.sgstPaise.toString(),
    igst_paise: purchase.igstPaise.toString(),
    gst_paise: purchase.gstPaise.toString(),
    total_paise: purchase.totalPaise.toString(),
    total_in_words: amountInWordsIndian(purchase.totalPaise),
    valid_until: validUntil,
    bank_details: bankDetails,
  };

  const inserted = await tx.query<{ id: string }>(
    `insert into public.invoices
       (account_id, purchase_id, type, number, financial_year, series, seller_gstin, buyer_gstin,
        place_of_supply_state_code, place_of_supply_state_name, sac_code, seller, buyer,
        line_items, totals, issued_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     returning id`,
    [
      purchase.accountId,
      purchase.id,
      type,
      number,
      financialYear,
      series,
      seller.gstin,
      acc.gstin,
      pos,
      buyer.state_name,
      sac,
      JSON.stringify(seller),
      JSON.stringify(buyer),
      JSON.stringify(lineItems),
      JSON.stringify(totals),
      now,
    ],
  );
  const id = inserted.rows[0]?.id;
  if (id === undefined) throw new Error("issueInvoice: insert returned no id");

  return {
    id,
    accountId: purchase.accountId,
    purchaseId: purchase.id,
    type,
    number,
    financialYear,
    series,
    seller,
    buyer,
    placeOfSupplyStateCode: pos,
    placeOfSupplyStateName: buyer.state_name,
    sacCode: sac,
    lineItems,
    totals,
    issuedAt: now,
  };
}

interface InvoiceRow {
  id: string;
  account_id: string;
  purchase_id: string;
  type: InvoiceType;
  number: string;
  financial_year: string;
  series: string;
  seller: unknown;
  buyer: unknown;
  place_of_supply_state_code: string;
  place_of_supply_state_name: string | null;
  sac_code: string;
  line_items: unknown;
  totals: unknown;
  issued_at: Date;
}

function toRecord(r: InvoiceRow): InvoiceRecord {
  return {
    id: r.id,
    accountId: r.account_id,
    purchaseId: r.purchase_id,
    type: r.type,
    number: r.number,
    financialYear: r.financial_year,
    series: r.series,
    seller: sellerSchema.parse(r.seller),
    buyer: buyerSchema.parse(r.buyer),
    placeOfSupplyStateCode: r.place_of_supply_state_code,
    placeOfSupplyStateName:
      r.place_of_supply_state_name ?? stateName(r.place_of_supply_state_code),
    sacCode: r.sac_code,
    lineItems: z.array(lineItemSchema).parse(r.line_items),
    totals: totalsSchema.parse(r.totals),
    issuedAt: r.issued_at,
  };
}

const INVOICE_COLUMNS = `id, account_id, purchase_id, type, number, financial_year, series, seller, buyer,
  place_of_supply_state_code, place_of_supply_state_name, sac_code, line_items, totals, issued_at`;

/** Load one invoice, scoped to its account. `accountId: null` is for admin paths only. */
export async function loadInvoice(
  db: Queryable,
  input: { invoiceId: string; accountId: string | null },
): Promise<InvoiceRecord | null> {
  const r = await db.query<InvoiceRow>(
    `select ${INVOICE_COLUMNS} from public.invoices
     where id = $1 and ($2::uuid is null or account_id = $2::uuid)`,
    [input.invoiceId, input.accountId],
  );
  const row = r.rows[0];
  return row === undefined ? null : toRecord(row);
}

export async function listInvoices(
  db: Queryable,
  accountId: string,
): Promise<InvoiceRecord[]> {
  const r = await db.query<InvoiceRow>(
    `select ${INVOICE_COLUMNS} from public.invoices where account_id = $1 order by issued_at desc, number desc`,
    [accountId],
  );
  return r.rows.map(toRecord);
}
