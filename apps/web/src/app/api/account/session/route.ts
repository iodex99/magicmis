import { requireAccount } from "@magicmis/accounts";

import { db } from "@/lib/db";
import { currentClaims, ok } from "@/lib/http";

/**
 * GET /api/account/session — lets an open tab discover it has been superseded, so it can
 * show SPEC §8's "You were signed out because this account signed in elsewhere."
 */
export async function GET(): Promise<Response> {
  const decision = await requireAccount(db(), await currentClaims());
  if (decision.ok) {
    return ok({ status: "active", businessName: decision.account.businessName });
  }
  return ok({ status: decision.reason });
}
