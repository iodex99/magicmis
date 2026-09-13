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

import { isValidGstin } from "@magicmis/core/identifiers";
import type { RoundingMode } from "@magicmis/core/money";
import { appendAudit } from "@magicmis/db/audit";
import { readConfig } from "@magicmis/db/config";
import { withTransaction, type Queryable } from "@magicmis/db/tx";
import { grantCreditsInTx } from "@magicmis/wallet";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";

import { computeGst, placeOfSupply, type GstBreakdown } from "./gst";
import { issueInvoice, sellerSchema, type InvoiceRecord } from "./invoice";
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
      | "INVALID_UTR",
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
  readonly credits: bigint;
  readonly bonusCredits: bigint;
  readonly gst: GstBreakdown;
  readonly placeOfSupplyStateCode: string;
  readonly bankTransferEligible: boolean;
}

interface PackRow {
  id: string;
  price_paise_ex_gst: string;
  credits_granted: string;
  bonus_credits: string;
}

async function accountTax(
  db: Queryable,
  accountId: string,
): Promise<{ gstin: string | null; stateCode: string }> {
  const r = await db.query<{ gstin: string | null; state_code: string }>(
    `select gstin, state_code from public.accounts where id = $1 and deleted_at is null`,
    [accountId],
  );
  const row = r.rows[0];
  if (row === undefined) throw new BillingError("ACCOUNT_NOT_FOUND", "account not found");
  // A GSTIN that fails its checksum is not used for place of supply.
  const gstin = row.gstin !== null && isValidGstin(row.gstin) ? row.gstin : null;
  return { gstin, stateCode: row.state_code };
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
  const pos = placeOfSupply(account);
  const taxable = BigInt(pack.price_paise_ex_gst);
  return {
    packId: pack.id,
    credits: BigInt(pack.credits_granted),
    bonusCredits: BigInt(pack.bonus_credits),
    gst: computeGst({
      taxablePaise: taxable,
      ratePercent: rate,
      sellerStateCode: seller.state_code,
      placeOfSupplyStateCode: pos,
      rounding,
    }),
    placeOfSupplyStateCode: pos,
    bankTransferEligible: taxable >= threshold,
  };
}

export async function listPackQuotes(
  db: Queryable,
  input: { accountId: string; now?: Date },
): Promise<PackQuote[]> {
  const now = input.now ?? new Date();
  const packs = await db.query<PackRow>(
    `select id, price_paise_ex_gst::text, credits_granted::text, bonus_credits::text
     from public.credit_packs where active order by sort_order, price_paise_ex_gst`,
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
  const r = await db.query<PackRow>(
    `select id, price_paise_ex_gst::text, credits_granted::text, bonus_credits::text
     from public.credit_packs where id = $1 and active`,
    [input.packId],
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
  readonly razorpayOrderId: string | null;
  readonly razorpayPaymentId: string | null;
  readonly bankUtr: string | null;
  readonly createdAt: Date;
  readonly creditedAt: Date | null;
}

const PURCHASE_COLUMNS = `id, account_id, pack_id, method, status,
  amount_paise_ex_gst::text as amount_paise_ex_gst, cgst_paise::text as cgst_paise,
  sgst_paise::text as sgst_paise, igst_paise::text as igst_paise, gst_paise::text as gst_paise,
  total_paise::text as total_paise, credits::text as credits, bonus_credits::text as bonus_credits,
  gst_rate, place_of_supply_state_code, razorpay_order_id, razorpay_payment_id, bank_utr,
  created_at, credited_at`;

interface PurchaseRow {
  id: string;
  account_id: string;
  pack_id: string | null;
  method: "razorpay" | "bank_transfer";
  status: PurchaseStatus;
  amount_paise_ex_gst: string;
  cgst_paise: string;
  sgst_paise: string;
  igst_paise: string;
  gst_paise: string;
  total_paise: string;
  credits: string;
  bonus_credits: string;
  gst_rate: string | null;
  place_of_supply_state_code: string | null;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  bank_utr: string | null;
  created_at: Date;
  credited_at: Date | null;
}

function toPurchase(r: PurchaseRow): Purchase {
  if (r.gst_rate === null || r.place_of_supply_state_code === null) {
    throw new Error(`purchase ${r.id} predates the GST snapshot columns`);
  }
  return {
    id: r.id,
    accountId: r.account_id,
    packId: r.pack_id,
    method: r.method,
    status: r.status,
    amountPaiseExGst: BigInt(r.amount_paise_ex_gst),
    cgstPaise: BigInt(r.cgst_paise),
    sgstPaise: BigInt(r.sgst_paise),
    igstPaise: BigInt(r.igst_paise),
    gstPaise: BigInt(r.gst_paise),
    totalPaise: BigInt(r.total_paise),
    credits: BigInt(r.credits),
    bonusCredits: BigInt(r.bonus_credits),
    gstRate: r.gst_rate,
    placeOfSupplyStateCode: r.place_of_supply_state_code,
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
  const g = input.quote.gst;
  const r = await tx.query<PurchaseRow>(
    `insert into public.purchases
       (account_id, pack_id, amount_paise_ex_gst, gst_paise, cgst_paise, sgst_paise, igst_paise,
        total_paise, method, status, credits, bonus_credits, gst_rate, place_of_supply_state_code,
        idempotency_key, bank_transfer_requested_at, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     returning ${PURCHASE_COLUMNS}`,
    [
      input.accountId,
      input.quote.packId,
      g.taxablePaise.toString(),
      g.gstPaise.toString(),
      g.cgstPaise.toString(),
      g.sgstPaise.toString(),
      g.igstPaise.toString(),
      g.totalPaise.toString(),
      input.method,
      input.status,
      input.quote.credits.toString(),
      input.quote.bonusCredits.toString(),
      g.ratePercent,
      input.quote.placeOfSupplyStateCode,
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
    // SPEC §11.1: bonus credits are a separate lot with the same expiry.
    await grantCreditsInTx(tx, {
      accountId: purchase.accountId,
      credits: purchase.bonusCredits,
      source: "bonus",
      idempotencyKey: `purchase:${purchase.id}:bonus`,
      purchaseId: purchase.id,
      expiresAt: main.expiresAt,
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
  readonly amountPaise: bigint;
  readonly currency: "INR";
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
      amountPaise: purchase.totalPaise,
      currency: "INR",
    };
  }

  // Outside any transaction: never hold locks across a network call. A failure leaves the
  // purchase `created`; a retry with the same idempotency key tries again.
  const order = await gateway.createOrder({
    amountPaise: purchase.totalPaise,
    receipt: purchase.id,
    notes: { purchase_id: purchase.id },
  });
  if (order.amountPaise !== purchase.totalPaise) {
    throw new Error("Razorpay order amount does not match the purchase total");
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
    amountPaise: purchase.totalPaise,
    currency: "INR",
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
  if (event.event !== "payment.captured" && event.event !== "order.paid") {
    return event.event === "payment.failed" ? "payment_failed_noted" : "ignored";
  }
  const payment = event.payload.payment?.entity;
  const orderId = payment?.order_id ?? event.payload.order?.entity.id ?? null;
  if (payment === undefined || orderId === null) return "missing_entities";
  if (payment.status !== "captured") return "payment_not_captured";

  const purchase = await purchaseBy(tx, "razorpay_order_id = $1", [orderId], true);
  if (purchase === null) return "unknown_order";
  if (purchase.method !== "razorpay") return "method_mismatch";
  if (purchase.status === "credited") return "already_credited";
  if (payment.currency !== "INR" || BigInt(payment.amount) !== purchase.totalPaise) {
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
