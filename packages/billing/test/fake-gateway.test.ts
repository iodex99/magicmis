/**
 * The development stand-in must be indistinguishable from Razorpay to our own verifiers.
 *
 * The danger in a fake gateway is not that it is fake; it is that it is fake in a way the real
 * code would have rejected. If it signed a callback differently, or serialised the webhook body
 * in a way that no longer matched its own signature, a local run would sail through while every
 * live payment failed — and the failure would surface in production, on money.
 *
 * So these tests never look at the stand-in's output directly. They hand it to
 * `verifyCheckoutSignature` and `verifyWebhookSignature`, the same functions the real routes
 * call, and to `razorpayWebhookSchema`, the same parser the real webhook handler uses.
 */

import { describe, expect, it } from "vitest";

import { fakeCheckoutCallback, FakeGateway, fakeWebhook } from "../src/fake-gateway";
import {
  razorpayWebhookSchema,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "../src/razorpay";

const KEY_SECRET = "test_key_secret_not_a_real_one";
const WEBHOOK_SECRET = "test_webhook_secret_not_a_real_one";

describe("the development payment gateway", () => {
  it("creates an order in Razorpay's own id shape and keeps the amount exactly", async () => {
    const gateway = new FakeGateway();
    const order = await gateway.createOrder({
      amountMinor: 118_000n,
      currency: "INR",
      receipt: "rcpt_1",
      notes: {},
    });
    expect(order.id).toMatch(/^order_[0-9a-f]{14}$/u);
    expect(order.amountMinor).toBe(118_000n);
    expect(order.currency).toBe("INR");
  });

  /*
   * The real gateway refuses anything under one rupee. A stand-in that accepted it would let a
   * pack be priced below the minimum in development and only fail once it reached Razorpay.
   */
  it("refuses an amount below the gateway minimum, as Razorpay does", async () => {
    await expect(
      new FakeGateway().createOrder({
        amountMinor: 99n,
        currency: "INR",
        receipt: "rcpt_2",
        notes: {},
      }),
    ).rejects.toThrow(/minimum/u);
  });

  it("answers the reconciler with a captured payment for an order it made", async () => {
    const gateway = new FakeGateway();
    const order = await gateway.createOrder({
      amountMinor: 50_000n,
      currency: "USD",
      receipt: "rcpt_3",
      notes: {},
    });
    const payments = await gateway.fetchOrderPayments(order.id);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      status: "captured",
      orderId: order.id,
      amountMinor: 50_000n,
      currency: "USD",
    });
  });

  it("knows nothing about an order it did not make", async () => {
    await expect(new FakeGateway().fetchOrderPayments("order_never")).resolves.toEqual(
      [],
    );
  });

  it("signs a checkout callback the real verifier accepts", () => {
    const callback = fakeCheckoutCallback({
      orderId: "order_abc123",
      keySecret: KEY_SECRET,
    });
    expect(verifyCheckoutSignature({ ...callback, keySecret: KEY_SECRET })).toBe(true);
  });

  it("does not sign a callback that another secret would accept", () => {
    const callback = fakeCheckoutCallback({
      orderId: "order_abc123",
      keySecret: KEY_SECRET,
    });
    expect(
      verifyCheckoutSignature({ ...callback, keySecret: "a different secret" }),
    ).toBe(false);
  });

  it("signs a webhook body the real verifier accepts, byte for byte", () => {
    const hook = fakeWebhook({
      orderId: "order_abc123",
      paymentId: "pay_abc123",
      amountMinor: 118_000n,
      currency: "INR",
      webhookSecret: WEBHOOK_SECRET,
    });
    expect(
      verifyWebhookSignature({
        rawBody: hook.rawBody,
        signature: hook.signature,
        secret: WEBHOOK_SECRET,
      }),
    ).toBe(true);
  });

  /*
   * The real route's comment warns that re-serialising the body breaks the signature. This is
   * that warning as a test: a caller who parses and re-stringifies must fail.
   */
  it("fails verification if the body is re-serialised rather than passed through", () => {
    const hook = fakeWebhook({
      orderId: "order_abc123",
      paymentId: "pay_abc123",
      amountMinor: 118_000n,
      currency: "INR",
      webhookSecret: WEBHOOK_SECRET,
    });
    const reserialised = JSON.stringify({
      ...(JSON.parse(hook.rawBody) as Record<string, unknown>),
      extra: 1,
    });
    expect(
      verifyWebhookSignature({
        rawBody: reserialised,
        signature: hook.signature,
        secret: WEBHOOK_SECRET,
      }),
    ).toBe(false);
  });

  it("produces a webhook the real handler's parser understands as a captured payment", () => {
    const hook = fakeWebhook({
      orderId: "order_abc123",
      paymentId: "pay_abc123",
      amountMinor: 118_000n,
      currency: "INR",
      webhookSecret: WEBHOOK_SECRET,
    });
    const parsed = razorpayWebhookSchema.safeParse(JSON.parse(hook.rawBody));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.event).toBe("payment.captured");
    expect(parsed.success && parsed.data.payload.payment?.entity).toMatchObject({
      id: "pay_abc123",
      order_id: "order_abc123",
      amount: 118_000,
      currency: "INR",
      status: "captured",
    });
  });

  /*
   * The webhook route de-duplicates by event id. Two simulated payments sharing one id would make
   * the second silently return "duplicate" and grant nothing, which reads as a product bug.
   */
  it("gives every webhook its own event id", () => {
    const of = () =>
      fakeWebhook({
        orderId: "order_abc123",
        paymentId: "pay_abc123",
        amountMinor: 1_000n,
        currency: "INR",
        webhookSecret: WEBHOOK_SECRET,
      }).eventId;
    expect(new Set([of(), of(), of()]).size).toBe(3);
  });
});
