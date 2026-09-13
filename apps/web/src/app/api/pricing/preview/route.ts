import { ACTION_KEYS, priceFor, PricingError, walletSummary } from "@magicmis/wallet";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, ok, parseJson, withAccount } from "@/lib/http";

const bodySchema = z.object({
  actionKey: z.enum(ACTION_KEYS),
  tier: z.enum(["efficient", "professional", "expert"]),
  delivery: z.enum(["standard", "instant"]),
});

/**
 * POST /api/pricing/preview — what the price confirmation shows before any charge
 * (SPEC §12): action, tier, delivery, exact credits, available balance, balance after.
 * Credits only; the AI cost cap never leaves the server (SPEC §2.5). Read-only.
 */
export async function POST(request: Request): Promise<Response> {
  return withAccount(async (account) => {
    const parsed = await parseJson(request, bodySchema);
    if (!parsed.ok) return parsed.response;
    try {
      const pool = db();
      const [quote, wallet] = await Promise.all([
        priceFor(pool, parsed.data),
        walletSummary(pool, account.accountId),
      ]);
      return ok({
        actionKey: quote.actionKey,
        tier: quote.tier,
        delivery: quote.delivery,
        credits: quote.credits.toString(),
        available: wallet.available.toString(),
        availableAfter: (wallet.available - quote.credits).toString(),
        sufficient: wallet.available >= quote.credits,
        priceBookVersion: quote.priceBookVersion,
      });
    } catch (error) {
      if (error instanceof PricingError) {
        return apiError(422, error.code, "This action is not available right now.");
      }
      throw error;
    }
  });
}
