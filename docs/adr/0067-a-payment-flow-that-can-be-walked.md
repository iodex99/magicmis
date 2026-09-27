# 0067 — A payment flow that can be walked

- **Status:** accepted
- **Date:** 2026-09-27
- **Relates to:** SPEC §13, ADR 0012 (Razorpay), R-26. Narrows R-26 rather than closing it.

## Context

The owner opened the Wallet on a local stack, pressed Buy, and nothing happened. The reasonable
conclusion from the outside was that payments had never been built.

They had. The Razorpay integration has been complete since Phase 2 and is written against the
gateway's own documentation: order creation, the Checkout callback signature, webhook
verification against the raw body with `x-razorpay-event-id` de-duplication and out-of-order
tolerance, payment fetch for reconciliation, then the credit grant, the GST split, gapless
invoice numbering and credit notes. Fifty unit tests cover it.

What did not exist was any way to *run* it.

- `paymentGateway()` always constructed a `RazorpayGateway` from `RAZORPAY_KEY_ID` and
  `RAZORPAY_KEY_SECRET`. There was no local substitute, unlike the AI transport
  (`AI_TRANSPORT=fake`) and the key wrapper (`KEY_WRAPPER=local`), both of which have one. On a
  machine with placeholder keys the first API call failed and the button died.
- Every test avoided the problem rather than solving it: the unit tests inject a `FakeGateway` or
  stub `fetch`, and the browser suite mocked `/api/wallet/purchases` and
  `checkout.razorpay.com/v1/checkout.js` away at the network edge. The file's own header said the
  card flow "needs live test credentials".

So the sequence the money actually takes — order, callback, webhook, credits, invoice — had never
been executed in one go by anything. Each link was tested; the chain was not. That is a real gap
independent of how it was found: an integration nobody can run is an integration nobody can
trust, and "it looks broken" from the owner's chair was a fair reading of the evidence available
to them.

## Decision

**A development stand-in for the gateway, `PAYMENT_GATEWAY=fake`, gated exactly as the AI fake
is.** `paymentGatewayIsFake()` throws unless `NEXT_PUBLIC_ENVIRONMENT` is `development`, at the
boundary rather than as a silent fall-through, because a fake gateway in production hands out
credits for nothing.

**It replaces Razorpay's HTTP and nothing else.** This is the whole point, so it is worth being
exact about what stays real:

- the callback signature is a real HMAC-SHA256 of `order_id|payment_id` under the configured key
  secret, and `fake-pay` hands it to the same `verifyCheckoutSignature` the live route calls;
- the webhook is a real HMAC of the raw body under the webhook secret, handed to the real
  `handleRazorpayWebhook`, so the signature check, the event de-duplication and the transaction
  all run;
- **credits come from the webhook, never from the callback** (SPEC §13), so the webhook is the
  part that had to be real — granting credits directly would have tested nothing worth testing;
- the credit grant, the GST split, the invoice number and the ledger are untouched production
  code.

The amount is written into the webhook body as a JSON integer from the `bigint`, with the same
`Number.MAX_SAFE_INTEGER` guard the real `createOrder` uses. A lint rule caught the first
attempt, which went through `Number()` — correctly: floating point has no business near an
amount, even in a fake.

**The stand-in is tested against the real verifiers, not against itself.**
`packages/billing/test/fake-gateway.test.ts` feeds its output to `verifyCheckoutSignature`,
`verifyWebhookSignature` and `razorpayWebhookSchema`. The danger in a fake is not that it is
fake but that it is fake in a way the real code would reject: signing differently, or
serialising a body that no longer matches its own signature, would let a local run pass while
every live payment failed. One test asserts that a re-serialised body fails verification, which
is the real route's warning comment turned into something that can break.

**Browser E2E now walks a whole purchase.** `wallet.spec.ts` buys a pack as an Indian account —
so the GST split is exercised rather than the zero-rated export path — and asserts the purchase
reaches `credited`, the balance equals the credits sold, and a `tax_invoice` exists numbered
`INV/YY-YY/NNNNNN` for the amount charged. The pre-existing test that mocks the route is kept:
it covers a different thing, that Checkout is opened with the right order.

## Consequences

Measured on the local stack, a purchase of the Starter pack by an Indian account:

| | |
| --- | --- |
| purchase | `credited`, 2000 credits, INR |
| charged | ₹2,360.00 |
| balance after | 2000 credits |
| invoice | `INV/26-27/000007`, `tax_invoice`, ₹2,360.00 |
| tax | IGST ₹360.00 at 18% |

₹2,000 plus 18% is ₹2,360, and 2000 credits for ₹2,000 ex-GST is locked decision 4 holding
exactly. Seven of seven wallet E2E tests pass; ten new unit tests, sixty in `billing`.

**What this is not.** It is evidence about our half of the contract, which is the half we own. It
says nothing about whether Razorpay accepts our order body, whether a test card pays it, or
whether the dashboard delivers the webhook — and a stand-in can never say so, because it is our
own code agreeing with itself. R-26 is narrowed to exactly that remainder and stays open; it
needs `rzp_test_…` keys from the owner's dashboard and a tunnel for webhook delivery to
localhost.

**The general lesson is about test doubles, not about payments.** Every link here was covered and
the chain was not, because each test reached for the cheapest double available and none of them
owned the seam between the parts. Where a flow crosses a vendor boundary, something has to
exercise the whole of our side of it, or the integration is only theoretically complete.
