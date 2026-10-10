import { z } from "zod";

import { db } from "@/lib/db";
import { ok, parseJson, withAccount } from "@/lib/http";
import { markRead } from "@/lib/server/inbox";

/** The newest notice the page showed; nothing newer is marked. */
const bodySchema = z.object({ upTo: z.iso.datetime({ offset: true }) }).strict();

/**
 * POST /api/account/inbox — marks the inbox read, once its page has been seen (ADR 0087).
 *
 * A POST rather than a side effect of opening the page: a GET can be started by any site that
 * links to it, and marking on render let one clear the unread count, sign-in notices included,
 * without the owner ever seeing them. The body is JSON, and the content type that requires is what
 * makes another origin's form unable to send this without a preflight.
 * Setting a read time twice changes nothing, so it takes no idempotency key (ADR 0059).
 */
export async function POST(request: Request): Promise<Response> {
  return withAccount(async (account) => {
    const parsed = await parseJson(request, bodySchema);
    if (!parsed.ok) return parsed.response;
    await markRead(db(), account.accountId, new Date(parsed.data.upTo));
    return ok({ read: true });
  });
}
