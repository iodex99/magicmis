import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, ok, parseJson, withAccount } from "@/lib/http";
import { displayNamesOnServer } from "@/lib/server/chat-deep";

export const maxDuration = 60;

const bodySchema = z.object({
  tokens: z
    .array(z.string().regex(/^[A-Z]+_[0-9a-f]{12}$/u))
    .min(1)
    .max(500),
});

/**
 * POST /api/companies/:id/chat/names {tokens} — the names behind party and person tokens in a chat
 * answer, for this company's owner only (ADR 0032). Null for a token no kept file contains.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      return apiError(404, "company_not_found", "Company not found.");
    const owned = await db().query(
      `select 1 from companies where id = $1 and account_id = $2 and deleted_at is null`,
      [id, account.accountId],
    );
    if (owned.rows.length === 0)
      return apiError(404, "company_not_found", "Company not found.");
    const parsed = await parseJson(request, bodySchema);
    if (!parsed.ok) return parsed.response;
    const names = await displayNamesOnServer(db(), {
      accountId: account.accountId,
      companyId: id,
      tokens: parsed.data.tokens,
    });
    return ok({ names });
  });
}
