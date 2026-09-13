import { hasFreshReauth } from "@magicmis/accounts";
import { deleteAccount } from "@magicmis/jobs";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, ok, parseJson, withAccount } from "@/lib/http";
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
        "Confirm your password and authenticator code to delete your account.",
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
    const pool = db();
    const held = await pool.query<{ held: string }>(
      `select held_credits::text as held from public.wallets where account_id = $1`,
      [account.accountId],
    );
    if ((held.rows[0]?.held ?? "0") !== "0") {
      return apiError(
        409,
        "jobs_in_progress",
        "A job or chat message is still in progress. Wait for it to finish or cancel it, then try again.",
      );
    }

    const { purgeAfter } = await deleteAccount(pool, { accountId: account.accountId });
    // The login goes now; the closed account row can no longer be reached through it.
    const { error } = await supabaseAdmin().auth.admin.deleteUser(account.authUserId);
    if (error !== null)
      console.error("account delete: auth user removal failed", error.message);
    await (await supabaseForRequest()).auth.signOut({ scope: "local" });
    return ok({ status: "deleted", purgeAfter: purgeAfter.toISOString() });
  });
}
