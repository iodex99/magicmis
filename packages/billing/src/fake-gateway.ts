/**
 * A stand-in for Razorpay, for development and browser tests only.
 *
 * The real integration has been complete since Phase 2 and is covered by 50 unit tests, but
 * every one of them either injects a fake gateway or stubs `fetch`, and the browser suite mocks
 * `/api/wallet/purchases` and `checkout.razorpay.com` outright. Nothing has ever walked the
 * whole way — buy a pack, get the credits, get the invoice — because `paymentGateway()` always
 * built a `RazorpayGateway` and there was no local substitute, unlike the AI transport
 * (`AI_TRANSPORT=fake`) and the key wrapper (`KEY_WRAPPER=local`). On a machine without live
 * Razorpay keys the Wallet's buttons simply failed, which is what made the flow look unbuilt.
 *
 * **What this replaces is Razorpay's HTTP and nothing else.** The order id is made up here; the
 * signatures below are computed with the same HMAC the real thing uses, from the configured
 * secrets, so `verifyCheckoutSignature` and `verifyWebhookSignature` do their real work, the
 * webhook is de-duplicated by its event id as usual, and the credits, the GST split and the
 * invoice all come from the production code path. A test that passes here is evidence about our
 * side of the contract, which is the half we own; only a live run against `rzp_test_…` keys
 * proves Razorpay's half (R-26).
 *
 * It is refused outside development by its caller, and it must stay that way: a fake gateway in
 * production is free credits.
 */

import { createHmac, randomUUID } from "node:crypto";

import type {
  CreateOrderInput,
  GatewayOrder,
  GatewayPayment,
  PaymentGateway,
} from "./razorpay";

/** `order_…`/`pay_…` ids in Razorpay's shape, so nothing downstream sees an odd string. */
const id = (prefix: string): string =>
  `${prefix}_${randomUUID().replace(/-/gu, "").slice(0, 14)}`;

export class FakeGateway implements PaymentGateway {
  /** Orders this instance made, so `fetchOrderPayments` can answer the reconciler. */
  private readonly orders = new Map<string, { amountMinor: bigint; currency: string }>();

  createOrder(input: CreateOrderInput): Promise<GatewayOrder> {
    // The real gateway refuses anything under one rupee, and a local run should meet the same
    // wall rather than discover it in production.
    if (input.amountMinor < 100n)
      return Promise.reject(
        new Error("amount below the gateway minimum of 100 minor units"),
      );
    const orderId = id("order");
    this.orders.set(orderId, {
      amountMinor: input.amountMinor,
      currency: input.currency,
    });
    return Promise.resolve({
      id: orderId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      status: "created",
    });
  }

  fetchOrderPayments(orderId: string): Promise<GatewayPayment[]> {
    const order = this.orders.get(orderId);
    if (order === undefined) return Promise.resolve([]);
    return Promise.resolve([
      {
        id: id("pay"),
        amountMinor: order.amountMinor,
        currency: order.currency,
        status: "captured",
        orderId,
      },
    ]);
  }
}

const hmacHex = (payload: string, secret: string): string =>
  createHmac("sha256", secret).update(payload).digest("hex");

/**
 * What Razorpay Checkout would hand back on success, signed so the real verify route accepts it.
 *
 * The signature is HMAC-SHA256 of `order_id|payment_id` under the key secret — the same
 * construction `verifyCheckoutSignature` checks, not a bypass of it.
 */
export function fakeCheckoutCallback(input: { orderId: string; keySecret: string }): {
  orderId: string;
  paymentId: string;
  signature: string;
} {
  const paymentId = id("pay");
  return {
    orderId: input.orderId,
    paymentId,
    signature: hmacHex(`${input.orderId}|${paymentId}`, input.keySecret),
  };
}

/**
 * A `payment.captured` webhook for an order, as raw body plus the headers the route reads.
 *
 * The body is returned as the exact string that was signed. Re-serialising it would change the
 * bytes and fail verification, which is the bug the real route's comment warns about, so callers
 * must post this string unmodified.
 */
export function fakeWebhook(input: {
  orderId: string;
  paymentId: string;
  amountMinor: bigint;
  currency: string;
  webhookSecret: string;
}): { rawBody: string; signature: string; eventId: string } {
  // Razorpay sends `amount` as a JSON integer, so the bigint is written straight into the text
  // rather than converted to a float — the same construction, and the same guard, the real
  // `createOrder` uses for its request body.
  if (input.amountMinor > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError("amount too large");
  const entity = [
    `"id":${JSON.stringify(input.paymentId)}`,
    `"amount":${input.amountMinor.toString()}`,
    `"currency":${JSON.stringify(input.currency)}`,
    `"status":"captured"`,
    `"order_id":${JSON.stringify(input.orderId)}`,
  ].join(",");
  const rawBody = `{"event":"payment.captured","payload":{"payment":{"entity":{${entity}}}}}`;
  return {
    rawBody,
    signature: hmacHex(rawBody, input.webhookSecret),
    // A fresh id every call: the route de-duplicates by it, and reusing one would make a second
    // simulated payment silently return "duplicate" instead of doing anything.
    eventId: `evt_fake_${randomUUID().replace(/-/gu, "").slice(0, 16)}`,
  };
}
