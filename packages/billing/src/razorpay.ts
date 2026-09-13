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
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

export interface CreateOrderInput {
  readonly amountPaise: bigint;
  readonly receipt: string;
  readonly notes: Readonly<Record<string, string>>;
}

export interface GatewayOrder {
  readonly id: string;
  readonly amountPaise: bigint;
  readonly currency: "INR";
  readonly status: string;
}

export interface PaymentGateway {
  createOrder(input: CreateOrderInput): Promise<GatewayOrder>;
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
  currency: z.literal("INR"),
  status: z.string(),
});

export class RazorpayGateway implements PaymentGateway {
  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl = "https://api.razorpay.com",
  ) {}

  async createOrder(input: CreateOrderInput): Promise<GatewayOrder> {
    if (input.amountPaise < 100n)
      throw new RangeError("Razorpay orders must be at least 100 paise");
    if (input.receipt.length > 40)
      throw new RangeError("Razorpay receipt exceeds 40 characters");
    if (Object.keys(input.notes).length > 15)
      throw new RangeError("Razorpay allows at most 15 notes");
    // Paise amounts for our packs are far below 2^53; the API takes a JSON integer.
    if (input.amountPaise > BigInt(Number.MAX_SAFE_INTEGER))
      throw new RangeError("amount too large");

    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64");
    const body = `{"amount":${input.amountPaise.toString()},"currency":"INR","receipt":${JSON.stringify(
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
      amountPaise: BigInt(parsed.data.amount),
      currency: parsed.data.currency,
      status: parsed.data.status,
    };
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
