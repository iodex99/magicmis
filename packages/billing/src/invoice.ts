/**
 * Tax invoices and proformas (SPEC §13, CGST Rule 46).
 *
 * An invoice row is a snapshot: seller and buyer details, place of supply, SAC, line
 * items and totals are copied in at issue time and the row is immutable (trigger in
 * migration 0007). The PDF is rendered from this row alone, so it can be regenerated
 * byte-for-byte at any time and never drifts from what was issued.
 */

import { GST_STATE_CODES, isGstStateCode } from "@magicmis/core/identifiers";
import { countryName } from "@magicmis/core/identifiers";
import type { Currency } from "@magicmis/core/money";
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
import { amountInWords } from "./words";

export type InvoiceType = "tax_invoice" | "proforma" | "credit_note";

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
  credit_note: z.string().regex(/^[A-Za-z0-9-]{1,6}$/u),
});

const billingAddressSchema = z
  .object({
    line1: z.string(),
    line2: z.string().optional(),
    city: z.string(),
    postalCode: z.string(),
    country: z.string(),
    stateCode: z.string(),
  })
  .partial();

export const buyerSchema = z.object({
  name: z.string(),
  gstin: z.string().nullable(),
  address: z.array(z.string()),
  /** ISO 3166-1 alpha-2. On an export invoice this is the place of supply. */
  country: z.string(),
  /** Indian supplies only: an export has no GST state. */
  state_code: z.string().nullable(),
  state_name: z.string().nullable(),
});
export type Buyer = z.infer<typeof buyerSchema>;

export const lineItemSchema = z.object({
  description: z.string(),
  sac: z.string(),
  credits: z.string().regex(/^\d+$/u),
  bonus_credits: z.string().regex(/^\d+$/u),
  taxable_minor: z.string().regex(/^\d+$/u),
});

/**
 * The export side of the invoice: the LUT the supply is made under and the endorsement
 * §16 requires on the document. Both are placeholders until the owner files the LUT
 * (R-59) and are guarded like the seller details (R-27).
 */
export const exportSchema = z.object({
  /**
   * The ARN in force when no year-specific one is recorded. Form GST RFD-11 is filed **once per
   * financial year**, so an invoice dated after the year turns is not covered by the previous
   * year's LUT and IGST becomes payable on that supply (ADR 0058).
   */
  lut_arn: z.string().min(1),
  /** Financial year label (`2026-27`) to the ARN filed for it. Preferred over `lut_arn`. */
  lut_by_fy: z.record(z.string(), z.string().min(1)).optional(),
  endorsement: z.string().min(1),
});

/** The ARN covering a financial year, or null when none has been recorded for it. */
export const lutArnFor = (
  config: z.infer<typeof exportSchema>,
  financialYear: string,
): string | null => config.lut_by_fy?.[financialYear] ?? config.lut_arn;

export const totalsSchema = z.object({
  /** ISO 4217. Every amount below is integer minor units of it (ADR 0030). */
  currency: z.enum(["INR", "USD"]),
  taxable_minor: z.string().regex(/^\d+$/u),
  gst_rate_percent: z.string(),
  supply: z.enum(["intra_state", "inter_state", "export"]),
  cgst_rate_percent: z.string().nullable(),
  sgst_rate_percent: z.string().nullable(),
  igst_rate_percent: z.string().nullable(),
  cgst_minor: z.string().regex(/^\d+$/u),
  sgst_minor: z.string().regex(/^\d+$/u),
  igst_minor: z.string().regex(/^\d+$/u),
  tax_minor: z.string().regex(/^\d+$/u),
  total_minor: z.string().regex(/^\d+$/u),
  total_in_words: z.string(),
  /**
   * Export only. The endorsement an export invoice must carry and the LUT it is made
   * under, snapshotted onto the document: an invoice records what was issued, and the
   * config it was read from changes underneath it.
   */
  export_endorsement: z.string().nullable(),
  lut_arn: z.string().nullable(),
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
  readonly placeOfSupplyStateCode: string | null;
  readonly placeOfSupplyStateName: string | null;
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

/**
 * Whether an invoice could be issued right now, asked before the money moves (ADR 0057).
 *
 * The same check runs inside `issueInvoice`, which is inside the transaction that grants the
 * credits — so with `billing.allow_placeholder_details` turned off before R-02/R-03/R-59 are
 * filled, every sale went to the gateway, was captured, and then threw on crediting, for every
 * customer at once. Refusing the sale up front is the same rule applied where it costs nothing.
 */
export async function invoiceDetailsReady(
  db: Queryable,
  currency: Currency,
  now = new Date(),
): Promise<{ ready: true } | { ready: false; reason: string }> {
  const allowPlaceholders = await readConfig(
    db,
    "billing.allow_placeholder_details",
    z.boolean(),
    now,
  );
  if (allowPlaceholders) return { ready: true };
  const seller = await readConfig(db, "billing.seller", sellerSchema, now);
  const sac = await readConfig(db, "billing.sac_code", z.string(), now);
  if (hasPlaceholder(seller) || hasPlaceholder(sac) || seller.gstin === "")
    return { ready: false, reason: "seller details or SAC code" };
  if (currency !== "INR") {
    const exportConfig = await readConfig(db, "billing.export", exportSchema, now).catch(
      () => null,
    );
    if (exportConfig !== null && hasPlaceholder(exportConfig))
      return { ready: false, reason: "the export declaration" };
    // The LUT is filed per financial year; selling into a year it does not cover would make
    // IGST payable on a supply invoiced as zero-rated (ADR 0058).
    if (
      exportConfig !== null &&
      lutArnFor(exportConfig, fyLabel(gstFinancialYear(now))) === null
    )
      return { ready: false, reason: "the LUT for this financial year" };
  }
  return { ready: true };
}

interface PurchaseForInvoice {
  readonly id: string;
  readonly accountId: string;
  readonly currency: Currency;
  readonly amountMinorExTax: bigint;
  readonly cgstMinor: bigint;
  readonly sgstMinor: bigint;
  readonly igstMinor: bigint;
  readonly taxMinor: bigint;
  readonly totalMinor: bigint;
  readonly credits: bigint;
  readonly bonusCredits: bigint;
  readonly gstRate: string;
  readonly placeOfSupplyStateCode: string | null;
  /** The buyer as they were at the moment of sale (ADR 0057). */
  readonly buyerCountry: string;
  readonly buyerGstin: string | null;
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
    billing_country: string | null;
  }>(
    `select business_name, gstin, billing_address, billing_country
       from public.accounts where id = $1`,
    [purchase.accountId],
  );
  const acc = account.rows[0];
  if (acc === undefined) throw new Error("issueInvoice: account not found");
  const address = billingAddressSchema.safeParse(acc.billing_address);
  const addr = address.success ? address.data : {};
  const pos = purchase.placeOfSupplyStateCode;
  const isExport = purchase.currency !== "INR";
  // From the sale, not from the account (ADR 0057). Reading these live let a customer who
  // corrected their address after paying make the country and the place of supply disagree, and
  // `invoices_place_of_supply_is_india_only` then refused the insert inside the very transaction
  // that grants the credits — money taken, credits rolled back, every retry the same.
  const country = purchase.buyerCountry;
  const buyer: Buyer = {
    name: acc.business_name,
    gstin: purchase.buyerGstin,
    address: [
      addr.line1,
      addr.line2,
      [addr.city, addr.postalCode].filter(Boolean).join(" "),
      // An export invoice names the buyer's country; a domestic one does not need to.
      isExport ? countryName(country) : undefined,
    ].filter((l): l is string => l !== undefined && l !== ""),
    country,
    state_code: pos,
    state_name: pos === null ? null : stateName(pos),
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

  // Zero-rated export, or a domestic supply split intra/inter state.
  const exportConfig = isExport
    ? await readConfig(tx, "billing.export", exportSchema, now)
    : null;
  if (!allowPlaceholders && exportConfig !== null && hasPlaceholder(exportConfig)) {
    throw new Error(
      "issueInvoice: export LUT details are placeholders (REVIEW_ITEMS R-59)",
    );
  }
  // The LUT is a per-year filing, so the year on the invoice decides which ARN applies.
  const lutArn = exportConfig === null ? null : lutArnFor(exportConfig, financialYear);
  if (!allowPlaceholders && exportConfig !== null && lutArn === null) {
    throw new Error(
      `issueInvoice: no LUT ARN recorded for ${financialYear} (REVIEW_ITEMS R-59, R-81)`,
    );
  }
  const intra = !isExport && purchase.igstMinor === 0n;
  const lineItems = [
    {
      description:
        purchase.bonusCredits > 0n
          ? `Prepaid service credits: ${purchase.credits.toString()} credits + ${purchase.bonusCredits.toString()} bonus credits`
          : `Prepaid service credits: ${purchase.credits.toString()} credits`,
      sac,
      credits: purchase.credits.toString(),
      bonus_credits: purchase.bonusCredits.toString(),
      taxable_minor: purchase.amountMinorExTax.toString(),
    },
  ];
  const totals: z.infer<typeof totalsSchema> = {
    currency: purchase.currency,
    taxable_minor: purchase.amountMinorExTax.toString(),
    gst_rate_percent: purchase.gstRate,
    supply: isExport ? "export" : intra ? "intra_state" : "inter_state",
    cgst_rate_percent: intra ? halfRate(purchase.gstRate) : null,
    sgst_rate_percent: intra ? halfRate(purchase.gstRate) : null,
    igst_rate_percent: isExport || intra ? null : purchase.gstRate,
    cgst_minor: purchase.cgstMinor.toString(),
    sgst_minor: purchase.sgstMinor.toString(),
    igst_minor: purchase.igstMinor.toString(),
    tax_minor: purchase.taxMinor.toString(),
    total_minor: purchase.totalMinor.toString(),
    total_in_words: amountInWords(purchase.currency, purchase.totalMinor),
    export_endorsement: exportConfig?.endorsement ?? null,
    lut_arn: lutArn,
    valid_until: validUntil,
    bank_details: bankDetails,
  };

  const inserted = await tx.query<{ id: string }>(
    `insert into public.invoices
       (account_id, purchase_id, type, number, financial_year, series, seller_gstin, buyer_gstin,
        place_of_supply_state_code, place_of_supply_state_name, sac_code, seller, buyer,
        line_items, totals, issued_at, currency, buyer_country, export_endorsement, lut_arn)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     returning id`,
    [
      purchase.accountId,
      purchase.id,
      type,
      number,
      financialYear,
      series,
      seller.gstin,
      purchase.buyerGstin,
      pos,
      buyer.state_name,
      sac,
      JSON.stringify(seller),
      JSON.stringify(buyer),
      JSON.stringify(lineItems),
      JSON.stringify(totals),
      now,
      purchase.currency,
      country,
      totals.export_endorsement,
      totals.lut_arn,
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
  // Null on an export invoice: there is no Indian place of supply (migration 0037). The row
  // type claimed `string`, so nothing stopped `toRecord` handing null to `stateName`.
  place_of_supply_state_code: string | null;
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
    // An export has neither, and `stateName` throws on anything that is not a GST state code.
    // Reading one used to throw, which took the whole Wallet page down for every customer
    // abroad from their first purchase onward (ADR 0053).
    placeOfSupplyStateName:
      r.place_of_supply_state_name ??
      (r.place_of_supply_state_code === null
        ? null
        : stateName(r.place_of_supply_state_code)),
    sacCode: r.sac_code,
    lineItems: z.array(lineItemSchema).parse(r.line_items),
    totals: totalsSchema.parse(r.totals),
    issuedAt: r.issued_at,
  };
}

/**
 * The credit note for a refund (ADR 0058, Rule 53 CGST Rules).
 *
 * A refund against a tax invoice reduces the taxable value and the tax on it, and §34 CGST Act
 * says that reduction is a document — there was none, and `invoices` is append-only by trigger,
 * so an invoice could not be corrected at all.
 *
 * Every particular except the amounts is copied from the invoice it corrects, which is what
 * Rule 53 asks for and is also safer than rebuilding them from config that may have moved. The
 * amounts are the reduction, as positive figures: the total is exactly the money returned, and
 * the taxable value and tax are split in the same proportion the sale had, so a partial refund
 * credits proportionate tax.
 *
 * TODO(review): R-10/R-12 — the wording, and the time limit §34 sets on issuing one, go to the
 * CA with the rest of the legal review.
 *
 * Returns null when the purchase has no tax invoice to correct (a refund before crediting).
 */
export async function issueCreditNote(
  tx: PoolClient,
  input: { purchaseId: string; refundedMinor: bigint; now: Date },
): Promise<InvoiceRecord | null> {
  if (input.refundedMinor <= 0n) return null;
  const original = await tx.query<InvoiceRow & { currency: Currency }>(
    `select ${INVOICE_COLUMNS}, currency from public.invoices
      where purchase_id = $1 and type = 'tax_invoice' order by issued_at limit 1`,
    [input.purchaseId],
  );
  const row = original.rows[0];
  if (row === undefined) return null;
  const source = toRecord(row);

  // Already credited: a second refund event for the same money must not issue a second note.
  const credited = await tx.query<{ total: string | null }>(
    `select coalesce(sum((totals->>'total_minor')::bigint), 0)::text as total
       from public.invoices where corrects_invoice_id = $1`,
    [source.id],
  );
  const alreadyCredited = BigInt(credited.rows[0]?.total ?? "0");
  const reduce = input.refundedMinor - alreadyCredited;
  if (reduce <= 0n) return null;

  const soldTaxable = BigInt(source.totals.taxable_minor);
  const soldTotal = BigInt(source.totals.total_minor);
  if (soldTotal <= 0n) return null;
  // Half-up on the taxable share; the tax line takes the remainder, so the note's total is the
  // refund to the last paisa.
  const taxable = (reduce * soldTaxable * 2n + soldTotal) / (soldTotal * 2n);
  const tax = reduce - taxable;
  const intra = BigInt(source.totals.cgst_minor) > 0n;
  const cgst = intra ? tax / 2n : 0n;
  const sgst = intra ? tax - cgst : 0n;
  const igst = intra ? 0n : tax;

  const seriesConfig = await readConfig(
    tx,
    "billing.invoice_series",
    invoiceSeriesSchema,
    input.now,
  );
  const fy = gstFinancialYear(input.now);
  const financialYear = fyLabel(fy);
  const format = await readConfig(
    tx,
    "billing.invoice_number_format",
    z.string(),
    input.now,
  );
  const seq = await nextInvoiceSequence(tx, {
    financialYear,
    series: seriesConfig.credit_note,
  });
  const number = formatInvoiceNumber(format, {
    series: seriesConfig.credit_note,
    fy,
    seq,
  });

  const lineItems = [
    {
      description: `Refund against invoice ${source.number}`,
      sac: source.sacCode,
      credits: "0",
      bonus_credits: "0",
      taxable_minor: taxable.toString(),
    },
  ];
  const totals: z.infer<typeof totalsSchema> = {
    ...source.totals,
    taxable_minor: taxable.toString(),
    cgst_minor: cgst.toString(),
    sgst_minor: sgst.toString(),
    igst_minor: igst.toString(),
    tax_minor: tax.toString(),
    total_minor: reduce.toString(),
    total_in_words: amountInWords(row.currency, reduce),
  };

  const inserted = await tx.query<{ id: string }>(
    `insert into public.invoices
       (account_id, purchase_id, type, number, financial_year, series, seller_gstin, buyer_gstin,
        place_of_supply_state_code, place_of_supply_state_name, sac_code, seller, buyer,
        line_items, totals, issued_at, currency, buyer_country, export_endorsement, lut_arn,
        corrects_invoice_id)
     select $1, $2, 'credit_note', $3, $4, $5, seller_gstin, buyer_gstin,
            place_of_supply_state_code, place_of_supply_state_name, sac_code, seller, buyer,
            $6::jsonb, $7::jsonb, $8, currency, buyer_country, export_endorsement, lut_arn, id
       from public.invoices where id = $9
     returning id`,
    [
      source.accountId,
      source.purchaseId,
      number,
      financialYear,
      seriesConfig.credit_note,
      JSON.stringify(lineItems),
      JSON.stringify(totals),
      input.now,
      source.id,
    ],
  );
  const id = inserted.rows[0]?.id;
  if (id === undefined) throw new Error("issueCreditNote: insert returned no id");

  return {
    ...source,
    id,
    type: "credit_note",
    number,
    financialYear,
    series: seriesConfig.credit_note,
    lineItems,
    totals,
    issuedAt: input.now,
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
