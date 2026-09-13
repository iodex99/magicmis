import { BillingError, createRazorpayPurchase, GatewayError } from "@magicmis/billing";
import { z } from "zod";

import { paymentGateway } from "@/lib/billing";
import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { apiError, idempotent, parseJson, withAccount } from "@/lib/http";

const bodySchema = z.object({ packId: z.uuid() });

/**
 * POST /api/wallet/purchases — create a purchase and a Razorpay Order for the pack total
 * including GST (SPEC §13). Credits are granted later, only by the verified webhook.
 *
 * Failures throw out of `idempotent`, which releases the key, so a retry with the same key
 * tries again rather than replaying the error.
 */
export async function POST(request: Request): Promise<Response> {
  return withAccount(async (account) => {
    const parsed = await parseJson(request, bodySchema);
    if (!parsed.ok) return parsed.response;
    const key = request.headers.get("idempotency-key") ?? "";

    try {
      return await idempotent(
        request,
        `purchase:${account.accountId}`,
        parsed.raw,
        async () => {
          const order = await createRazorpayPurchase(db(), paymentGateway(), {
            accountId: account.accountId,
            packId: parsed.data.packId,
            idempotencyKey: key,
          });
          return {
            status: 201,
            body: {
              purchaseId: order.purchaseId,
              orderId: order.orderId,
              amountPaise: order.amountPaise.toString(),
              currency: order.currency,
              keyId: serverEnv().RAZORPAY_KEY_ID,
            },
          };
        },
      );
    } catch (error) {
      if (error instanceof BillingError && error.code === "PACK_NOT_FOUND") {
        return apiError(
          404,
          "pack_not_found",
          "That pack is no longer available. Reload the page.",
        );
      }
      if (error instanceof GatewayError) {
        return apiError(
          502,
          "payment_gateway_unavailable",
          "The payment provider did not respond. Try again in a minute.",
        );
      }
      throw error;
    }
  });
}
