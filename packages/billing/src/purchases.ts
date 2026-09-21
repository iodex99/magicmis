/**
 * Credit purchases (SPEC §13).
 *
 * - Razorpay: create a purchase and an Order for the total including GST. Credits are
 *   granted only by a verified, de-duplicated webhook; the checkout callback is advisory.
 * - Bank transfer: for packs at or above the configured threshold, issue a proforma; an
 *   admin marks it received with the UTR, which credits the purchase.
 *
 * Crediting is one transaction: lock the purchase, grant the purchase lot and the bonus
 * lot (same expiry), issue the tax invoice from the row-locked counter, mark credited,
 * audit, queue the email. Lock order everywhere: purchase → wallet → invoice counter →
 * audit log.
 */

import { createHash } from "node:crypto";

import {
  isGstStateCode,
  isValidGstin,
  normaliseCountry,
} from "@magicmis/core/identifiers";
import { billingCurrency, type Currency, type RoundingMode } from "@magicmis/core/money";
import { appendAudit } from "@magicmis/db/audit";
import { readConfig } from "@magicmis/db/config";
import { withTransaction, type Queryable } from "@magicmis/db/tx";
import { grantCreditsInTx } from "@magicmis/wallet";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";

import { placeOfSupply } from "./gst";
import { computeSaleTax, type SaleTax } from "./tax";
import {
  invoiceDetailsReady,
  issueInvoice,
  sellerSchema,
  type InvoiceRecord,
} from "./invoice";
import {
  razorpayWebhookSchema,
  verifyWebhookSignature,
  type PaymentGateway,
} from "./razorpay";

export class BillingError extends Error {
  constructor(
    readonly code:
      | "PACK_NOT_FOUND"
      | "ACCOUNT_NOT_FOUND"
      | "BANK_TRANSFER_NOT_ELIGIBLE"
      | "PURCHASE_NOT_FOUND"
      | "PURCHASE_NOT_PENDING"
      | "INVALID_UTR"
      /** No billing state on the account yet: GST cannot be quoted or invoiced. */
      | "BILLING_STATE_UNKNOWN"
      /** Seller, SAC or export details are still placeholders, so no invoice could be issued. */
      | "BILLING_NOT_READY",
    message: string,
  ) {
    super(message);
    this.name = "BillingError";
  }
}

const roundingSchema = z.enum([
  "half_up",
  "half_even",
  "ceil",
  "floor",
  "trunc",
  "expand",
]);

// ---------------------------------------------------------------------------
// Pack quotes: what the user sees before paying (ex-GST price and the GST line)
// ---------------------------------------------------------------------------

export interface PackQuote {
  readonly packId: string;
  /** The tier name (ADR 0041); null for a pack that was never given one. */
  readonly name: string | null;
  readonly credits: bigint;
  readonly bonusCredits: bigint;
  /** GST for an Indian buyer, zero-rated export for anyone else (ADR 0030). */
  readonly tax: SaleTax;
  readonly currency: Currency;
  readonly placeOfSupplyStateCode: string | null;
  /** Snapshotted onto the purchase, so the invoice is built from the sale (ADR 0057). */
  readonly buyerGstin: string | null;
  readonly bankTransferEligible: boolean;
}

interface PackRow {
  id: string;
  name: string | null;
  price_minor_ex_tax: string;
  credits_granted: string;
  bonus_credits: string;
}

/**
 * The buyer's tax identity.
 *
 * Billing details are collected at the first purchase rather than at sign-up (migration
 * 0034), so an account can reach here without a state. GST place of supply cannot be
 * guessed, so this refuses rather than defaulting to one -- a wrong place of supply is a
 * wrong tax invoice.
 */
export interface BuyerTaxIdentity {
  readonly gstin: string | null;
  /** Null for a buyer outside India, which has no GST place of supply. */
  readonly stateCode: string | null;
  readonly country: string;
  readonly currency: Currency;
}

async function accountTax(db: Queryable, accountId: string): Promise<BuyerTaxIdentity> {
  const r = await db.query<{
    gstin: string | null;
    state_code: string | null;
    billing_country: string | null;
  }>(
    `select gstin, state_code, billing_country
       from public.accounts where id = $1 and deleted_at is null`,
    [accountId],
  );
  const row = r.rows[0];
  if (row === undefined) throw new BillingError("ACCOUNT_NOT_FOUND", "account not found");

  // Billing details are collected at the first purchase (migration 0034), so an account
  // can reach here with none. The country decides the currency AND the tax treatment, so
  // it is refused rather than assumed -- defaulting would either charge Indian GST to
  // someone abroad or zero-rate a domestic sale, and both are wrong on a tax document.
  if (row.billing_country === null)
    throw new BillingError(
      "BILLING_STATE_UNKNOWN",
      "the account has no billing country yet",
    );
  const country = normaliseCountry(row.billing_country);
  const currency = billingCurrency(country);

  if (currency !== "INR") {
    return { gstin: null, stateCode: null, country, currency };
  }

  // A GSTIN that fails its checksum is not used for place of supply — nor is one whose leading
  // two digits name no assigned GST state, because `stateName` cannot render it and the throw
  // would land inside the transaction that grants the credits (ADR 0057).
  const gstin =
    row.gstin !== null && isValidGstin(row.gstin) && isGstStateCode(row.gstin.slice(0, 2))
      ? row.gstin
      : null;
  const stateCode = gstin?.slice(0, 2) ?? row.state_code;
  if (stateCode === null)
    throw new BillingError(
      "BILLING_STATE_UNKNOWN",
      "the account has no billing state yet",
    );
  return { gstin, stateCode, country, currency };
}

async function buildQuote(
  db: Queryable,
  pack: PackRow,
  accountId: string,
  now: Date,
): Promise<PackQuote> {
  const account = await accountTax(db, accountId);
  const rate = await readConfig(
    db,
    "billing.gst_rate_percent",
    z.string().regex(/^\d+(\.\d+)?$/u),
    now,
  );
  const seller = await readConfig(db, "billing.seller", sellerSchema, now);
  const rounding: RoundingMode = await readConfig(
    db,
    "billing.tax_rounding_mode",
    roundingSchema,
    now,
  );
  const threshold = BigInt(
    await readConfig(
      db,
      "billing.bank_transfer_min_paise",
      z.number().int().positive(),
      now,
    ),
  );
  const pos =
    account.stateCode === null
      ? undefined
      : placeOfSupply({ gstin: account.gstin, stateCode: account.stateCode });
  const taxable = BigInt(pack.price_minor_ex_tax);
  const tax = computeSaleTax({
    taxableMinor: taxable,
    buyerCountry: account.country,
    placeOfSupplyStateCode: pos,
    sellerStateCode: seller.state_code,
    ratePercent: rate,
    rounding,
  });
  return {
    packId: pack.id,
    name: pack.name,
    credits: BigInt(pack.credits_granted),
    bonusCredits: BigInt(pack.bonus_credits),
    tax,
    currency: tax.currency,
    placeOfSupplyStateCode: tax.placeOfSupplyStateCode,
    buyerGstin: account.gstin,
    // The threshold is a rupee amount, so it only decides anything for a rupee sale.
    // Bank transfer is an Indian bank transfer against a proforma; an international wire
    // is a different process (FIRC, RBI purpose code) and is not offered (migration 0037).
    bankTransferEligible: tax.currency === "INR" && taxable >= threshold,
  };
}

export async function listPackQuotes(
  db: Queryable,
  input: { accountId: string; now?: Date },
): Promise<PackQuote[]> {
  const now = input.now ?? new Date();
  // The account's currency decides which price list is read. A pack with no row in that
  // currency is simply not offered there, which is a state the join expresses directly.
  const account = await accountTax(db, input.accountId);
  const packs = await db.query<PackRow>(
    `select p.id, p.name, pp.price_minor_ex_tax::text, p.credits_granted::text, p.bonus_credits::text
       from public.credit_packs p
       join public.credit_pack_prices pp
         on pp.pack_id = p.id and pp.currency = $1
      where p.active
      order by p.sort_order, pp.price_minor_ex_tax`,
    [account.currency],
  );
  const quotes: PackQuote[] = [];
  for (const pack of packs.rows)
    quotes.push(await buildQuote(db, pack, input.accountId, now));
  return quotes;
}

export async function quotePack(
  db: Queryable,
  input: { accountId: string; packId: string; now?: Date },
): Promise<PackQuote> {
  const account = await accountTax(db, input.accountId);
  const r = await db.query<PackRow>(
    `select p.id, p.name, pp.price_minor_ex_tax::text, p.credits_granted::text, p.bonus_credits::text
       from public.credit_packs p
       join public.credit_pack_prices pp
         on pp.pack_id = p.id and pp.currency = $2
      where p.id = $1 and p.active`,
    [input.packId, account.currency],
  );
  const pack = r.rows[0];
  if (pack === undefined)
    throw new BillingError("PACK_NOT_FOUND", "pack not found or inactive");
  return buildQuote(db, pack, input.accountId, input.now ?? new Date());
}

// ---------------------------------------------------------------------------
// Purchase rows
// ---------------------------------------------------------------------------

export type PurchaseStatus =
  "created" | "pending" | "paid" | "credited" | "failed" | "refunded";

export interface Purchase {
  readonly id: string;
  readonly accountId: string;
  readonly packId: string | null;
  readonly method: "razorpay" | "bank_transfer";
  readonly status: PurchaseStatus;
  readonly currency: Currency;
  /** Integer minor units of `currency`: paise for INR, cents for USD. */
  readonly amountMinorExTax: bigint;
  readonly cgstMinor: bigint;
  readonly sgstMinor: bigint;
  readonly igstMinor: bigint;
  readonly taxMinor: bigint;
  readonly totalMinor: bigint;
  readonly credits: bigint;
  readonly bonusCredits: bigint;
  /** "0" on an export, which is zero-rated rather than untaxed. */
  readonly gstRate: string;
  /** Null on an export: there is no Indian place of supply. */
  readonly placeOfSupplyStateCode: string | null;
  /**
   * The buyer as they were at the moment of sale (ADR 0057). The invoice is built from these,
   * never from the account row, which the customer may have corrected in between.
   */
  readonly buyerCountry: string;
  readonly buyerGstin: string | null;
  readonly razorpayOrderId: string | null;
  readonly razorpayPaymentId: string | null;
  readonly bankUtr: string | null;
  readonly createdAt: Date;
  readonly creditedAt: Date | null;
}

const PURCHASE_COLUMNS = `id, account_id, pack_id, method, status, currency,
  amount_minor_ex_tax::text as amount_minor_ex_tax, cgst_minor::text as cgst_minor,
  sgst_minor::text as sgst_minor, igst_minor::text as igst_minor, tax_minor::text as tax_minor,
  total_minor::text as total_minor, credits::text as credits, bonus_credits::text as bonus_credits,
  gst_rate, place_of_supply_state_code, buyer_country, buyer_gstin,
  razorpay_order_id, razorpay_payment_id, bank_utr,
  created_at, credited_at`;

interface PurchaseRow {
  id: string;
  account_id: string;
  pack_id: string | null;
  method: "razorpay" | "bank_transfer";
  status: PurchaseStatus;
  currency: Currency;
  amount_minor_ex_tax: string;
  cgst_minor: string;
  sgst_minor: string;
  igst_minor: string;
  tax_minor: string;
  total_minor: string;
  credits: string;
  bonus_credits: string;
  gst_rate: string | null;
  place_of_supply_state_code: string | null;
  buyer_country: string;
  buyer_gstin: string | null;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  bank_utr: string | null;
  created_at: Date;
  credited_at: Date | null;
}

function toPurchase(r: PurchaseRow): Purchase {
  if (r.gst_rate === null) {
    throw new Error(`purchase ${r.id} predates the tax snapshot columns`);
  }
  // An export has no Indian place of supply, and a domestic sale must have one.
  if (r.currency === "INR" && r.place_of_supply_state_code === null) {
    throw new Error(`purchase ${r.id} is a rupee sale with no place of supply`);
  }
  return {
    id: r.id,
    accountId: r.account_id,
    packId: r.pack_id,
    method: r.method,
    status: r.status,
    currency: r.currency,
    amountMinorExTax: BigInt(r.amount_minor_ex_tax),
    cgstMinor: BigInt(r.cgst_minor),
    sgstMinor: BigInt(r.sgst_minor),
    igstMinor: BigInt(r.igst_minor),
    taxMinor: BigInt(r.tax_minor),
    totalMinor: BigInt(r.total_minor),
    credits: BigInt(r.credits),
    bonusCredits: BigInt(r.bonus_credits),
    gstRate: r.gst_rate,
    placeOfSupplyStateCode: r.place_of_supply_state_code,
    buyerCountry: r.buyer_country,
    buyerGstin: r.buyer_gstin,
    razorpayOrderId: r.razorpay_order_id,
    razorpayPaymentId: r.razorpay_payment_id,
    bankUtr: r.bank_utr,
    createdAt: r.created_at,
    creditedAt: r.credited_at,
  };
}

async function purchaseBy(
  db: Queryable,
  where: string,
  values: unknown[],
  lock = false,
): Promise<Purchase | null> {
  const r = await db.query<PurchaseRow>(
    `select ${PURCHASE_COLUMNS} from public.purchases where ${where}${lock ? " for update" : ""}`,
    values,
  );
  const row = r.rows[0];
  return row === undefined ? null : toPurchase(row);
}

export async function listPurchases(
  db: Queryable,
  accountId: string,
): Promise<Purchase[]> {
  const r = await db.query<PurchaseRow>(
    `select ${PURCHASE_COLUMNS} from public.purchases where account_id = $1 order by created_at desc`,
    [accountId],
  );
  return r.rows.map(toPurchase);
}

async function insertPurchase(
  tx: PoolClient,
  input: {
    accountId: string;
    quote: PackQuote;
    method: "razorpay" | "bank_transfer";
    status: PurchaseStatus;
    idempotencyKey: string;
    now: Date;
  },
): Promise<Purchase> {
  const t = input.quote.tax;
  const r = await tx.query<PurchaseRow>(
    `insert into public.purchases
       (account_id, pack_id, currency, amount_minor_ex_tax, tax_minor, cgst_minor, sgst_minor,
        igst_minor, total_minor, method, status, credits, bonus_credits, gst_rate,
        place_of_supply_state_code, buyer_country, buyer_gstin,
        idempotency_key, bank_transfer_requested_at, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     returning ${PURCHASE_COLUMNS}`,
    [
      input.accountId,
      input.quote.packId,
      t.currency,
      t.taxableMinor.toString(),
      t.taxMinor.toString(),
      t.cgstMinor.toString(),
      t.sgstMinor.toString(),
      t.igstMinor.toString(),
      t.totalMinor.toString(),
      input.method,
      input.status,
      input.quote.credits.toString(),
      input.quote.bonusCredits.toString(),
      t.ratePercent,
      t.placeOfSupplyStateCode,
      // The buyer as they were, not as the account reads today (ADR 0057).
      t.buyerCountry,
      input.quote.buyerGstin,
      input.idempotencyKey,
      input.method === "bank_transfer" ? input.now : null,
      input.now,
    ],
  );
  const row = r.rows[0];
  if (row === undefined) throw new Error("insertPurchase: insert returned no row");
  return toPurchase(row);
}

async function queueNotification(
  tx: PoolClient,
  input: {
    accountId: string;
    type: string;
    payload: Record<string, string>;
    dedupeKey: string;
  },
): Promise<void> {
  await tx.query(
    `insert into public.notifications (account_id, type, payload, dedupe_key)
     values ($1, $2, $3, $4) on conflict (account_id, dedupe_key) do nothing`,
    [input.accountId, input.type, JSON.stringify(input.payload), input.dedupeKey],
  );
}

// ---------------------------------------------------------------------------
// Crediting
// ---------------------------------------------------------------------------

export type CreditOutcome =
  | { readonly status: "credited"; readonly invoice: InvoiceRecord }
  | { readonly status: "already_credited" };

/** Caller holds the purchase row lock. */
async function creditPurchaseInTx(
  tx: PoolClient,
  purchase: Purchase,
  input: {
    now: Date;
    razorpayPaymentId?: string;
    bankUtr?: string;
    adminId?: string;
  },
): Promise<CreditOutcome> {
  if (purchase.status === "credited") return { status: "already_credited" };

  const main = await grantCreditsInTx(tx, {
    accountId: purchase.accountId,
    credits: purchase.credits,
    source: "purchase",
    idempotencyKey: `purchase:${purchase.id}:credits`,
    purchaseId: purchase.id,
    now: input.now,
  });
  if (main.status !== "granted")
    throw new Error(`purchase ${purchase.id} was granted but not marked credited`);
  if (purchase.bonusCredits > 0n) {
    // SPEC §11.1: bonus credits are a separate lot, granted after the purchase lot so it
    // is the purchase's own credits that are spent first.
    await grantCreditsInTx(tx, {
      accountId: purchase.accountId,
      credits: purchase.bonusCredits,
      source: "bonus",
      idempotencyKey: `purchase:${purchase.id}:bonus`,
      purchaseId: purchase.id,
      now: input.now,
    });
  }

  const invoice = await issueInvoice(tx, {
    purchase,
    type: "tax_invoice",
    now: input.now,
  });

  await tx.query(
    `update public.purchases
       set status = 'credited', credited_at = $2,
           razorpay_payment_id = coalesce($3, razorpay_payment_id),
           bank_utr = coalesce($4, bank_utr),
           received_by_admin_id = coalesce($5::uuid, received_by_admin_id)
     where id = $1`,
    [
      purchase.id,
      input.now,
      input.razorpayPaymentId ?? null,
      input.bankUtr ?? null,
      input.adminId ?? null,
    ],
  );

  await appendAudit(tx, {
    actorType: input.adminId === undefined ? "system" : "admin",
    actorId: input.adminId ?? null,
    action: "billing.purchase_credited",
    targetType: "purchase",
    targetId: purchase.id,
    metadata: {
      accountId: purchase.accountId,
      method: purchase.method,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
    },
  });
  await queueNotification(tx, {
    accountId: purchase.accountId,
    type: "invoice_issued",
    payload: { invoiceId: invoice.id, purchaseId: purchase.id },
    dedupeKey: `invoice:${invoice.id}`,
  });
  return { status: "credited", invoice };
}

// ---------------------------------------------------------------------------
// Razorpay
// ---------------------------------------------------------------------------

export interface CheckoutOrder {
  readonly purchaseId: string;
  readonly orderId: string;
  /** Integer minor units of `currency`, which is what Razorpay Checkout expects. */
  readonly amountMinor: bigint;
  readonly currency: Currency;
}

export async function createRazorpayPurchase(
  pool: Pool,
  gateway: PaymentGateway,
  input: { accountId: string; packId: string; idempotencyKey: string; now?: Date },
): Promise<CheckoutOrder> {
  const now = input.now ?? new Date();

  const purchase = await withTransaction(pool, async (tx) => {
    const existing = await purchaseBy(tx, "account_id = $1 and idempotency_key = $2", [
      input.accountId,
      input.idempotencyKey,
    ]);
    if (existing !== null) return existing;
    const quote = await quotePack(tx, {
      accountId: input.accountId,
      packId: input.packId,
      now,
    });
    // Refuse the sale before the money moves, not on the way to granting the credits
    // (ADR 0057). The same check lives inside `issueInvoice`, where failing it means the
    // payment has already been captured and the throw rolls the credit grant back.
    const ready = await invoiceDetailsReady(tx, quote.currency, now);
    if (!ready.ready)
      throw new BillingError(
        "BILLING_NOT_READY",
        `credits cannot be sold yet: ${ready.reason} are not set`,
      );
    return insertPurchase(tx, {
      accountId: input.accountId,
      quote,
      method: "razorpay",
      status: "created",
      idempotencyKey: input.idempotencyKey,
      now,
    });
  });

  if (purchase.razorpayOrderId !== null) {
    return {
      purchaseId: purchase.id,
      orderId: purchase.razorpayOrderId,
      amountMinor: purchase.totalMinor,
      currency: purchase.currency,
    };
  }

  // Outside any transaction: never hold locks across a network call. A failure leaves the
  // purchase `created`; a retry with the same idempotency key tries again.
  const order = await gateway.createOrder({
    amountMinor: purchase.totalMinor,
    currency: purchase.currency,
    receipt: purchase.id,
    notes: { purchase_id: purchase.id },
  });
  // Both, not just the amount: an order created in the wrong currency would charge
  // a hundredth or a hundredfold of what the customer agreed to.
  if (order.amountMinor !== purchase.totalMinor || order.currency !== purchase.currency) {
    throw new Error("Razorpay order does not match the purchase total and currency");
  }

  const updated = await pool.query<{ razorpay_order_id: string }>(
    `update public.purchases set razorpay_order_id = coalesce(razorpay_order_id, $2), status = 'pending'
     where id = $1 returning razorpay_order_id`,
    [purchase.id, order.id],
  );
  const orderId = updated.rows[0]?.razorpay_order_id ?? order.id;
  return {
    purchaseId: purchase.id,
    orderId,
    amountMinor: purchase.totalMinor,
    currency: purchase.currency,
  };
}

export type WebhookResult =
  | { readonly status: "invalid_signature" }
  | { readonly status: "malformed" }
  | { readonly status: "duplicate" }
  | { readonly status: "processed"; readonly outcome: string };

/**
 * Handle a Razorpay webhook. The event insert and its effect share one transaction: if
 * processing throws, the event is not recorded and Razorpay's retry processes it again.
 */
export async function handleRazorpayWebhook(
  pool: Pool,
  input: {
    rawBody: string;
    signature: string;
    eventId: string;
    secret: string;
    now?: Date;
  },
): Promise<WebhookResult> {
  if (
    !verifyWebhookSignature({
      rawBody: input.rawBody,
      signature: input.signature,
      secret: input.secret,
    })
  ) {
    return { status: "invalid_signature" };
  }
  if (input.eventId === "" || input.eventId.length > 200) return { status: "malformed" };
  let json: unknown;
  try {
    json = JSON.parse(input.rawBody);
  } catch {
    return { status: "malformed" };
  }
  const parsed = razorpayWebhookSchema.safeParse(json);
  if (!parsed.success) return { status: "malformed" };
  const event = parsed.data;
  const now = input.now ?? new Date();

  return withTransaction(pool, async (tx) => {
    const inserted = await tx.query(
      `insert into public.webhook_events (provider, event_id, event_type, payload_hash, received_at)
       values ('razorpay', $1, $2, $3, $4) on conflict do nothing`,
      [
        input.eventId,
        event.event,
        createHash("sha256").update(input.rawBody).digest("hex"),
        now,
      ],
    );
    if (inserted.rowCount === 0) return { status: "duplicate" } as const;

    const outcome = await processRazorpayEvent(tx, event, now);
    await tx.query(
      `update public.webhook_events set processed_at = $3, outcome = $4
       where provider = 'razorpay' and event_id = $1 and event_type = $2`,
      [input.eventId, event.event, now, outcome],
    );
    return { status: "processed", outcome } as const;
  });
}

async function processRazorpayEvent(
  tx: PoolClient,
  event: z.infer<typeof razorpayWebhookSchema>,
  now: Date,
): Promise<string> {
  /*
   * A refund is recorded, never acted on (ADR 0054).
   *
   * Credits are sold non-refundable and there is no cash-out, so nothing here reverses a
   * grant: taking credits back could drive a balance negative, and credits already spent
   * cannot be taken back at all. That is a decision for a person, not a webhook.
   *
   * What must not happen is silence. Before this, a refund issued in the gateway dashboard
   * returned "ignored": our ledger and the gateway's diverged with nothing anywhere to say
   * so. Now the purchase is marked refunded and the fact is on the audit log, where the
   * daily digest and any reconciliation will find it.
   */
  if (event.event.startsWith("refund.")) {
    const refunded = event.payload.payment?.entity;
    const orderId = refunded?.order_id ?? null;
    if (orderId === null) return "refund_missing_order";
    const purchase = await purchaseBy(tx, "razorpay_order_id = $1", [orderId], true);
    if (purchase === null) return "refund_unknown_order";
    await tx.query(
      `update public.purchases set status = 'refunded', updated_at = $2 where id = $1`,
      [purchase.id, now],
    );
    await appendAudit(tx, {
      actorType: "system",
      action: "billing.refund_recorded",
      targetType: "purchase",
      targetId: purchase.id,
      metadata: { orderId, event: event.event },
    });
    return "refund_recorded";
  }
  if (event.event !== "payment.captured" && event.event !== "order.paid") {
    if (event.event !== "payment.failed") return "ignored";
    // Actually note it (ADR 0057). The purchase used to stay 'pending' for ever: the reconciler
    // kept fetching it from Razorpay every fifteen minutes until it aged out, and the customer's
    // Wallet showed a payment in progress that was never going to arrive.
    const failedOrder =
      event.payload.payment?.entity.order_id ?? event.payload.order?.entity.id ?? null;
    if (failedOrder === null) return "payment_failed_noted";
    await tx.query(
      `update public.purchases set status = 'failed'
        where razorpay_order_id = $1 and status in ('created', 'pending')`,
      [failedOrder],
    );
    return "payment_failed_noted";
  }
  const payment = event.payload.payment?.entity;
  const orderId = payment?.order_id ?? event.payload.order?.entity.id ?? null;
  if (payment === undefined || orderId === null) return "missing_entities";
  if (payment.status !== "captured") return "payment_not_captured";

  const purchase = await purchaseBy(tx, "razorpay_order_id = $1", [orderId], true);
  if (purchase === null) {
    // A captured payment we cannot match to a sale is money received against nothing. It used
    // to leave only a string in `webhook_events.outcome`; now it is on the audit log, where an
    // operator looks (ADR 0057).
    await appendAudit(tx, {
      actorType: "system",
      action: "billing.payment_unknown_order",
      // There is no purchase to point at — that is the whole finding. The gateway ids are not
      // UUIDs, so they live in the metadata.
      targetType: "purchase",
      targetId: null,
      metadata: { orderId, paymentId: payment.id },
    });
    return "unknown_order";
  }
  if (purchase.method !== "razorpay") return "method_mismatch";
  if (purchase.status === "credited") return "already_credited";
  // Razorpay documents that events may arrive out of order, so a capture retry can land after a
  // refund was recorded. Crediting then would leave the customer holding both the money and the
  // credits, and would erase the refund from the purchase row (ADR 0057).
  if (purchase.status === "refunded") {
    await appendAudit(tx, {
      actorType: "system",
      action: "billing.capture_after_refund",
      targetType: "purchase",
      targetId: purchase.id,
      metadata: { orderId, paymentId: payment.id },
    });
    return "already_refunded";
  }
  // The webhook is the only place credits are granted, so this comparison is what
  // stands between a manipulated payment and a free wallet. Currency included: the same
  // integer means very different money in paise and in cents.
  if (
    payment.currency !== purchase.currency ||
    BigInt(payment.amount) !== purchase.totalMinor
  ) {
    await appendAudit(tx, {
      actorType: "system",
      action: "billing.payment_amount_mismatch",
      targetType: "purchase",
      targetId: purchase.id,
      metadata: { orderId, paymentId: payment.id },
    });
    return "amount_mismatch";
  }
  const result = await creditPurchaseInTx(tx, purchase, {
    now,
    razorpayPaymentId: payment.id,
  });
  return result.status;
}

const reconcileConfigSchema = z.object({
  after_minutes: z.number().int().positive(),
  max_age_days: z.number().int().positive(),
  batch_size: z.number().int().positive(),
});

export interface ReconcileResult {
  readonly checked: number;
  readonly credited: number;
  readonly amountMismatches: number;
  readonly failures: number;
}

/**
 * Worker (R-51, docs/runbooks/payment-webhook-outage.md): Razorpay purchases still unpaid past
 * `billing.reconcile.after_minutes` are checked against Razorpay directly. A captured INR payment for
 * the exact total is credited through the same path as the webhook — credits, bonus lot, tax invoice,
 * audit and notice — so a lost or disabled webhook never leaves a paying customer without credits.
 * The server trusts only what it fetched from Razorpay, never anything the browser reported.
 */
export async function reconcileRazorpayPurchases(
  pool: Pool,
  gateway: PaymentGateway,
  now: Date = new Date(),
): Promise<ReconcileResult> {
  const cfg = await readConfig(pool, "billing.reconcile", reconcileConfigSchema, now);
  const stuck = await pool.query<{ id: string; razorpay_order_id: string }>(
    `select id, razorpay_order_id from public.purchases
     where method = 'razorpay' and status in ('created', 'pending', 'paid') and razorpay_order_id is not null
       and created_at <= $1 and created_at >= $2
     order by created_at limit $3`,
    [
      new Date(now.getTime() - cfg.after_minutes * 60_000),
      new Date(now.getTime() - cfg.max_age_days * 86_400_000),
      cfg.batch_size,
    ],
  );
  let credited = 0;
  let amountMismatches = 0;
  let failures = 0;
  for (const row of stuck.rows) {
    try {
      const payments = await gateway.fetchOrderPayments(row.razorpay_order_id);
      const captured = payments.filter(
        (p) => p.status === "captured" && p.orderId === row.razorpay_order_id,
      );
      if (captured.length === 0) continue;
      const outcome = await withTransaction(pool, async (tx) => {
        const purchase = await purchaseBy(tx, "id = $1", [row.id], true);
        if (purchase === null || purchase.status === "credited")
          return "already_credited";
        const payment = captured.find(
          (p) =>
            p.currency === purchase.currency && p.amountMinor === purchase.totalMinor,
        );
        if (payment === undefined) {
          await appendAudit(tx, {
            actorType: "system",
            action: "billing.payment_amount_mismatch",
            targetType: "purchase",
            targetId: purchase.id,
            metadata: { orderId: row.razorpay_order_id, source: "reconciliation" },
          });
          return "amount_mismatch";
        }
        const result = await creditPurchaseInTx(tx, purchase, {
          now,
          razorpayPaymentId: payment.id,
        });
        if (result.status === "credited")
          await appendAudit(tx, {
            actorType: "system",
            action: "billing.purchase_reconciled",
            targetType: "purchase",
            targetId: purchase.id,
            metadata: { orderId: row.razorpay_order_id, paymentId: payment.id },
          });
        return result.status;
      });
      if (outcome === "credited") credited += 1;
      if (outcome === "amount_mismatch") amountMismatches += 1;
    } catch {
      // One unreachable order must not stop the rest; the next run retries it.
      failures += 1;
    }
  }
  return { checked: stuck.rows.length, credited, amountMismatches, failures };
}

// ---------------------------------------------------------------------------
// Bank transfer
// ---------------------------------------------------------------------------

export async function requestBankTransfer(
  pool: Pool,
  input: { accountId: string; packId: string; idempotencyKey: string; now?: Date },
): Promise<{ purchase: Purchase; proforma: InvoiceRecord | null }> {
  const now = input.now ?? new Date();
  return withTransaction(pool, async (tx) => {
    const existing = await purchaseBy(tx, "account_id = $1 and idempotency_key = $2", [
      input.accountId,
      input.idempotencyKey,
    ]);
    if (existing !== null) return { purchase: existing, proforma: null };

    const quote = await quotePack(tx, {
      accountId: input.accountId,
      packId: input.packId,
      now,
    });
    // Refuse the sale before the money moves, not on the way to granting the credits
    // (ADR 0057). The same check lives inside `issueInvoice`, where failing it means the
    // payment has already been captured and the throw rolls the credit grant back.
    const ready = await invoiceDetailsReady(tx, quote.currency, now);
    if (!ready.ready)
      throw new BillingError(
        "BILLING_NOT_READY",
        `credits cannot be sold yet: ${ready.reason} are not set`,
      );
    if (!quote.bankTransferEligible) {
      throw new BillingError(
        "BANK_TRANSFER_NOT_ELIGIBLE",
        "bank transfer is not available for this pack",
      );
    }
    const purchase = await insertPurchase(tx, {
      accountId: input.accountId,
      quote,
      method: "bank_transfer",
      status: "pending",
      idempotencyKey: input.idempotencyKey,
      now,
    });
    const proforma = await issueInvoice(tx, { purchase, type: "proforma", now });
    await appendAudit(tx, {
      actorType: "account",
      actorId: input.accountId,
      action: "billing.bank_transfer_requested",
      targetType: "purchase",
      targetId: purchase.id,
      metadata: { proformaId: proforma.id, proformaNumber: proforma.number },
    });
    await queueNotification(tx, {
      accountId: input.accountId,
      type: "proforma_issued",
      payload: { invoiceId: proforma.id, purchaseId: purchase.id },
      dedupeKey: `invoice:${proforma.id}`,
    });
    return { purchase, proforma };
  });
}

/** Indian bank UTRs: NEFT 16, RTGS 22, IMPS 12 characters, alphanumeric. */
const UTR_PATTERN = /^[A-Z0-9]{12,22}$/u;

export async function markBankTransferReceived(
  pool: Pool,
  input: { purchaseId: string; utr: string; adminId: string; now?: Date },
): Promise<CreditOutcome> {
  const utr = input.utr.trim().toUpperCase();
  if (!UTR_PATTERN.test(utr))
    throw new BillingError("INVALID_UTR", "UTR must be 12–22 letters or digits");
  const now = input.now ?? new Date();

  return withTransaction(pool, async (tx) => {
    const purchase = await purchaseBy(tx, "id = $1", [input.purchaseId], true);
    if (purchase === null || purchase.method !== "bank_transfer") {
      throw new BillingError("PURCHASE_NOT_FOUND", "bank transfer purchase not found");
    }
    if (purchase.status === "credited") return { status: "already_credited" } as const;
    if (purchase.status !== "pending") {
      throw new BillingError("PURCHASE_NOT_PENDING", `purchase is ${purchase.status}`);
    }
    await appendAudit(tx, {
      actorType: "admin",
      actorId: input.adminId,
      action: "billing.bank_transfer_received",
      targetType: "purchase",
      targetId: purchase.id,
      metadata: { utr },
    });
    return creditPurchaseInTx(tx, purchase, {
      now,
      bankUtr: utr,
      adminId: input.adminId,
    });
  });
}
