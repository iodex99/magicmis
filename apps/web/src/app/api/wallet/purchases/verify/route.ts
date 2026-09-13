import { verifyCheckoutSignature } from "@magicmis/billing";
import { z } from "zod";

import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { apiError, ok, parseJson, withAccount } from "@/lib/http";

const bodySchema = z.object({
  orderId: z.string().min(1).max(64),
  paymentId: z.string().min(1).max(64),
  signature: z.string().regex(/^[0-9a-f]{64}$/iu),
});

/**
 * POST /api/wallet/purchases/verify — the Checkout success callback (SPEC §13).
 *
 * Verifies the signature so the page can say "payment received" honestly, but grants
 * nothing: credits come only from the de-duplicated webhook. Read-only, so no idempotency key.
 */
export async function POST(request: Request): Promise<Response> {
  return withAccount(async (account) => {
    const parsed = await parseJson(request, bodySchema);
    if (!parsed.ok) return parsed.response;

    const owned = await db().query<{ status: string }>(
      `select status from public.purchases where razorpay_order_id = $1 and account_id = $2`,
      [parsed.data.orderId, account.accountId],
    );
    const purchase = owned.rows[0];
    if (purchase === undefined)
      return apiError(404, "purchase_not_found", "Purchase not found.");

    const valid = verifyCheckoutSignature({
      orderId: parsed.data.orderId,
      paymentId: parsed.data.paymentId,
      signature: parsed.data.signature,
      keySecret: serverEnv().RAZORPAY_KEY_SECRET,
    });
    if (!valid) {
      return apiError(
        400,
        "signature_invalid",
        "We could not confirm this payment. If money left your account, it will be credited or refunded by the payment provider.",
      );
    }
    return ok({
      status: purchase.status === "credited" ? "credited" : "awaiting_confirmation",
    });
  });
}
