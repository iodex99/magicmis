import { z } from "zod";

import { db } from "@/lib/db";
import { ok, parseJson, withAccount } from "@/lib/http";
import { setBrandOn } from "@/lib/server/brand";

const patchSchema = z.object({ on: z.boolean() }).strict();

/**
 * PATCH /api/account/brand — whether the account's name and logo appear as the preparer, in
 * Present and on the workbook's cover (ADR 0087). A switch on an existing row: a retry leaves it
 * the same, so it takes no idempotency key (ADR 0059).
 */
export async function PATCH(request: Request): Promise<Response> {
  return withAccount(async (account) => {
    const parsed = await parseJson(request, patchSchema);
    if (!parsed.ok) return parsed.response;
    await setBrandOn(db(), account.accountId, parsed.data.on);
    return ok({ on: parsed.data.on });
  });
}
