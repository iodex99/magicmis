import {
  fakeCheckoutCallback,
  fakeWebhook,
  handleRazorpayWebhook,
  verifyCheckoutSignature,
} from "@magicmis/billing";
import { z } from "zod";

import { paymentGatewayIsFake } from "@/lib/billing";
import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { apiError, ok, parseJson, withAccount } from "@/lib/http";

const bodySchema = z.object({ orderId: z.string().min(1).max(64) });

/**
 * POST /api/wallet/purchases/fake-pay — pay a pending purchase without Razorpay.
 *
 * Development only. It exists because the real flow could not be walked on a machine with no
 * live Razorpay keys, which made a complete integration look like a missing one. What it
 * simulates is Razorpay's two callbacks and nothing else:
 *
 *  1. the Checkout success callback, signed under the key secret, checked here by the same
 *     `verifyCheckoutSignature` the real verify route calls; and
 *  2. a `payment.captured` webhook, signed under the webhook secret, handed to the real
 *     `handleRazorpayWebhook` — so the signature check, the event de-duplication, the credit
 *     grant, the GST split and the invoice are all the production path.
 *
 * Credits come from the webhook, never from the callback (SPEC §13), so the webhook is the part
 * that has to be real here; faking the grant directly would test nothing worth testing.
 *
 * The gate is `paymentGatewayIsFake()`, which throws outside development, plus an ownership
 * check on the order: even in development this must not pay another account's purchase.
 */
export async function POST(request: Request): Promise<Response> {
  return withAccount(async (account) => {
    if (!paymentGatewayIsFake())
      return apiError(
        404,
        "not_found",
        "This endpoint exists only when the payment gateway is the development stand-in.",
      );

    const parsed = await parseJson(request, bodySchema);
    if (!parsed.ok) return parsed.response;

    const owned = await db().query<{
      status: string;
      total_minor: string;
      currency: string;
    }>(
      `select status, total_minor::text as total_minor, currency
         from public.purchases where razorpay_order_id = $1 and account_id = $2`,
      [parsed.data.orderId, account.accountId],
    );
    const purchase = owned.rows[0];
    if (purchase === undefined)
      return apiError(404, "purchase_not_found", "Purchase not found.");

    const env = serverEnv();
    const callback = fakeCheckoutCallback({
      orderId: parsed.data.orderId,
      keySecret: env.RAZORPAY_KEY_SECRET,
    });
    // Not ceremony: if the stand-in ever signed differently from what the real route accepts,
    // a development run would pass while production rejected every payment.
    if (
      !verifyCheckoutSignature({
        orderId: callback.orderId,
        paymentId: callback.paymentId,
        signature: callback.signature,
        keySecret: env.RAZORPAY_KEY_SECRET,
      })
    )
      return apiError(
        500,
        "signature_mismatch",
        "The stand-in signed a callback the verifier rejected.",
      );

    const hook = fakeWebhook({
      orderId: parsed.data.orderId,
      paymentId: callback.paymentId,
      amountMinor: BigInt(purchase.total_minor),
      currency: purchase.currency,
      webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
    });
    const result = await handleRazorpayWebhook(db(), {
      rawBody: hook.rawBody,
      signature: hook.signature,
      eventId: hook.eventId,
      secret: env.RAZORPAY_WEBHOOK_SECRET,
    });

    return ok({
      paymentId: callback.paymentId,
      webhook: result.status,
      outcome: result.status === "processed" ? result.outcome : null,
    });
  });
}
