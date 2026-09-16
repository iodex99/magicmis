import { hasFreshReauth } from "@magicmis/accounts";
import { AccountBusy, deleteAccount } from "@magicmis/jobs";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, idempotent, parseJson, withAccount } from "@/lib/http";
import { supabaseAdmin, supabaseForRequest } from "@/lib/supabase/server";

const bodySchema = z.object({ confirmEmail: z.string().max(320) });

/**
 * POST /api/account/delete — erase the account (SPEC §10, §31). Requires re-authentication and the
 * account email typed out. The account closes at once; companies and the account key are
 * crypto-shredded after `lifecycle.deletion_purge_delay_days`. Billing records stay for the
 * statutory period with personal fields minimised at purge.
 */
export async function POST(request: Request): Promise<Response> {
  return withAccount(async (account) => {
    if (!(await hasFreshReauth(db(), account))) {
      return apiError(
        403,
        "reauth_required",
        "Confirm your password to delete your account.",
      );
    }
    const parsed = await parseJson(request, bodySchema);
    if (!parsed.ok) return parsed.response;
    if (parsed.data.confirmEmail.trim().toLowerCase() !== account.email.toLowerCase()) {
      return apiError(
        422,
        "confirmation_mismatch",
        "Type your account email exactly to confirm deletion.",
        { confirmEmail: "Does not match" },
      );
    }
    try {
      return await idempotent(
        request,
        `account-delete:${account.accountId}`,
        { action: "delete_account" },
        async () => {
          const { purgeAfter } = await deleteAccount(db(), {
            accountId: account.accountId,
          });
          // The login goes now; the closed account row can no longer be reached through it.
          const { error } = await supabaseAdmin().auth.admin.deleteUser(
            account.authUserId,
          );
          if (error !== null)
            console.error("account delete: auth user removal failed", error.message);
          await (await supabaseForRequest()).auth.signOut({ scope: "local" });
          return {
            status: 200,
            body: { status: "deleted", purgeAfter: purgeAfter.toISOString() },
          };
        },
      );
    } catch (error) {
      if (!(error instanceof AccountBusy)) throw error;
      return apiError(
        409,
        "jobs_in_progress",
        "A job or chat message is still in progress. Wait for it to finish or cancel it, then try again.",
      );
    }
  });
}
