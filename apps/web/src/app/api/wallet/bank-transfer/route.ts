import { BillingError, requestBankTransfer } from "@magicmis/billing";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, idempotent, parseJson, withAccount } from "@/lib/http";

const bodySchema = z.object({ packId: z.uuid() });

/** POST /api/wallet/bank-transfer — request a proforma for an eligible pack (SPEC §13). */
export async function POST(request: Request): Promise<Response> {
  return withAccount(async (account) => {
    const parsed = await parseJson(request, bodySchema);
    if (!parsed.ok) return parsed.response;
    const key = request.headers.get("idempotency-key") ?? "";

    try {
      return await idempotent(
        request,
        `bank-transfer:${account.accountId}`,
        parsed.raw,
        async () => {
          const { purchase, proforma } = await requestBankTransfer(db(), {
            accountId: account.accountId,
            packId: parsed.data.packId,
            idempotencyKey: key,
          });
          return {
            status: 201,
            body: {
              purchaseId: purchase.id,
              proformaId: proforma?.id ?? null,
              proformaNumber: proforma?.number ?? null,
            },
          };
        },
      );
    } catch (error) {
      if (error instanceof BillingError) {
        if (error.code === "BANK_TRANSFER_NOT_ELIGIBLE") {
          return apiError(
            422,
            "bank_transfer_not_eligible",
            "Bank transfer is available for larger packs only. Pay online for this pack.",
          );
        }
        if (error.code === "PACK_NOT_FOUND") {
          return apiError(
            404,
            "pack_not_found",
            "That pack is no longer available. Reload the page.",
          );
        }
        if (error.code === "BILLING_STATE_UNKNOWN") {
          return apiError(
            422,
            "billing_details_required",
            "Add your billing address in the Wallet first — GST depends on where you are invoiced.",
          );
        }
      }
      throw error;
    }
  });
}
