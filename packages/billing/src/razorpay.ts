/**
 * Razorpay behind a `PaymentGateway` interface (SPEC §13). Verified 2026-09-13:
 *
 * - Orders: `POST https://api.razorpay.com/v1/orders`, HTTP basic auth key_id:key_secret;
 *   `amount` in paise (min 100), `currency`, `receipt` ≤ 40 chars, `notes` ≤ 15 pairs.
 *   https://razorpay.com/docs/api/orders/create/
 * - Checkout callback signature: HMAC-SHA256(`order_id|razorpay_payment_id`, key_secret), hex.
 *   https://razorpay.com/docs/payments/server-integration/nodejs/integration-steps/
 * - Webhook: `X-Razorpay-Signature` = HMAC-SHA256(raw body, webhook secret), hex. Verify the
 *   raw body before parsing; `x-razorpay-event-id` de-duplicates; events may arrive out of
 *   order. https://razorpay.com/docs/webhooks/validate-test/
 * - `payment.captured` and `order.paid` payload shapes: https://razorpay.com/docs/webhooks/payments/
 * - Payments of an order: `GET https://api.razorpay.com/v1/orders/{order_id}/payments`, basic auth;
 *   `{ entity: "collection", count, items: [{ id, amount, currency, status, order_id, captured }] }`,
 *   authorised or failed payments for the order (verified 2026-09-14).
 *   https://razorpay.com/docs/api/orders/fetch-payments/
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import type { Currency } from "@magicmis/core/money";
import { z } from "zod";

export interface CreateOrderInput {
  /** Integer minor units of `currency`: paise for INR, cents for USD. */
  readonly amountMinor: bigint;
  readonly currency: Currency;
  readonly receipt: string;
  readonly notes: Readonly<Record<string, string>>;
}

export interface GatewayOrder {
  readonly id: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly status: string;
}

export interface GatewayPayment {
  readonly id: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly status: string;
  readonly orderId: string | null;
}

export interface PaymentGateway {
  createOrder(input: CreateOrderInput): Promise<GatewayOrder>;
  /** Payments Razorpay holds for an order, for reconciliation when webhooks did not arrive. */
  fetchOrderPayments(orderId: string): Promise<GatewayPayment[]>;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

const orderResponseSchema = z.object({
  id: z.string().min(1),
  amount: z.number().int().positive(),
  currency: z.string(),
  status: z.string(),
});

const orderPaymentsSchema = z.object({
  entity: z.literal("collection"),
  items: z.array(
    z
      .object({
        id: z.string().min(1),
        amount: z.number().int().nonnegative(),
        currency: z.string(),
        status: z.string(),
        order_id: z.string().nullable().optional(),
      })
      .loose(),
  ),
});

export class RazorpayGateway implements PaymentGateway {
  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl = "https://api.razorpay.com",
  ) {}

  async createOrder(input: CreateOrderInput): Promise<GatewayOrder> {
    // Razorpay's floor is 100 minor units in any currency it accepts. Our smallest
    // pack is far above it in both; this catches a misconfigured price, not a sale.
    if (input.amountMinor < 100n)
      throw new RangeError("Razorpay orders must be at least 100 minor units");
    if (input.receipt.length > 40)
      throw new RangeError("Razorpay receipt exceeds 40 characters");
    if (Object.keys(input.notes).length > 15)
      throw new RangeError("Razorpay allows at most 15 notes");
    // Amounts for our packs are far below 2^53; the API takes a JSON integer.
    if (input.amountMinor > BigInt(Number.MAX_SAFE_INTEGER))
      throw new RangeError("amount too large");

    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64");
    const body = `{"amount":${input.amountMinor.toString()},"currency":${JSON.stringify(
      input.currency,
    )},"receipt":${JSON.stringify(
      input.receipt,
    )},"notes":${JSON.stringify(input.notes)}}`;
    const res = await this.fetchImpl(`${this.baseUrl}/v1/orders`, {
      method: "POST",
      headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok)
      throw new GatewayError(
        `Razorpay order creation failed (${res.status.toString()})`,
        res.status,
      );
    const parsed = orderResponseSchema.safeParse(json);
    if (!parsed.success)
      throw new GatewayError(
        "Razorpay order response did not match the schema",
        res.status,
      );
    return {
      id: parsed.data.id,
      amountMinor: BigInt(parsed.data.amount),
      currency: parsed.data.currency,
      status: parsed.data.status,
    };
  }

  async fetchOrderPayments(orderId: string): Promise<GatewayPayment[]> {
    if (!/^order_[A-Za-z0-9]{1,40}$/u.test(orderId))
      throw new RangeError("not a Razorpay order id");
    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64");
    const res = await this.fetchImpl(`${this.baseUrl}/v1/orders/${orderId}/payments`, {
      headers: { authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(15_000),
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok)
      throw new GatewayError(
        `Razorpay order payments fetch failed (${res.status.toString()})`,
        res.status,
      );
    const parsed = orderPaymentsSchema.safeParse(json);
    if (!parsed.success)
      throw new GatewayError(
        "Razorpay order payments did not match the schema",
        res.status,
      );
    return parsed.data.items.map((p) => ({
      id: p.id,
      amountMinor: BigInt(p.amount),
      currency: p.currency,
      status: p.status,
      orderId: p.order_id ?? null,
    }));
  }
}

function hmacHex(message: string | Buffer, secret: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

function safeHexEqual(expectedHex: string, givenHex: string): boolean {
  if (!/^[0-9a-f]+$/iu.test(givenHex)) return false;
  const a = Buffer.from(expectedHex, "hex");
  const b = Buffer.from(givenHex, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Checkout success callback. Informational only: credits come from the webhook. */
export function verifyCheckoutSignature(input: {
  orderId: string;
  paymentId: string;
  signature: string;
  keySecret: string;
}): boolean {
  return safeHexEqual(
    hmacHex(`${input.orderId}|${input.paymentId}`, input.keySecret),
    input.signature,
  );
}

/** Webhook signature over the exact raw bytes received. */
export function verifyWebhookSignature(input: {
  rawBody: string | Buffer;
  signature: string;
  secret: string;
}): boolean {
  if (input.secret === "") return false;
  return safeHexEqual(hmacHex(input.rawBody, input.secret), input.signature);
}

const paymentEntitySchema = z.object({
  id: z.string().min(1),
  amount: z.number().int().nonnegative(),
  currency: z.string(),
  status: z.string(),
  order_id: z.string().nullable().optional(),
});

export const razorpayWebhookSchema = z.object({
  event: z.string().min(1),
  payload: z
    .object({
      payment: z.object({ entity: paymentEntitySchema }).optional(),
      // The refund's own entity. Without it every `refund.*` event read as a full refund
      // whatever the amount (ADR 0058).
      // https://razorpay.com/docs/webhooks/payloads/refunds/ (verified 2026-09-21)
      refund: z
        .object({
          entity: z.object({
            id: z.string().min(1),
            amount: z.number().int().nonnegative(),
            currency: z.string().optional(),
            payment_id: z.string().optional(),
          }),
        })
        .optional(),
      order: z
        .object({
          entity: z.object({
            id: z.string().min(1),
            amount: z.number().int(),
            status: z.string(),
          }),
        })
        .optional(),
    })
    .loose(),
});
export type RazorpayWebhook = z.infer<typeof razorpayWebhookSchema>;
