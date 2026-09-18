import {
  checkThrottle,
  claimSession,
  registerFailure,
  sessionClaimsSchema,
  signupRequestSchema,
  throttleLimitFor,
} from "@magicmis/accounts";
import { one, withTransaction } from "@magicmis/db/tx";
import { z } from "zod";

import { SupabaseAuthProvider } from "@/lib/auth-provider";
import { db } from "@/lib/db";
import { apiError, ok, parseJson, requestMeta } from "@/lib/http";
import { setAccountPassword } from "@/lib/server/password";
import { supabaseForRequest } from "@/lib/supabase/server";

/**
 * POST /api/auth/reset — spend an emailed reset token on a new password (SPEC §8, ADR 0043).
 *
 * The token is verified **here, on a POST, together with the new password**, and nowhere else.
 * Two things follow from that, and both were found by the security review of the first design,
 * which verified the link on a GET and recorded it as a general re-authentication:
 *
 * - Opening the link does nothing on its own. A link someone else sends you cannot sign you in
 *   to *their* account by being clicked; you would have to choose a password for it.
 * - The token authorises exactly one thing — this account's password, once — and is consumed
 *   doing it. It never becomes a grant that could also export the data or delete the account,
 *   which is what the password re-check exists to guard on an unlocked machine with the mail
 *   client open.
 *
 * Guesses are throttled by network; a wrong token counts, a right one does not.
 */
const bodySchema = z.object({
  tokenHash: z.string().min(16).max(512),
  newPassword: signupRequestSchema.shape.password,
});

const EXPIRED = "That link has expired or has already been used. Ask for a new one.";

export async function POST(request: Request): Promise<Response> {
  const parsed = await parseJson(request, bodySchema);
  if (!parsed.ok) return parsed.response;
  const { ip, userAgent } = await requestMeta();
  const pool = db();

  const limit = await throttleLimitFor(pool, "password_reset");
  const key = `password_reset_verify:ip:${ip ?? "unknown"}`;
  const state = await checkThrottle(pool, key);
  if (state.locked) {
    return apiError(429, "too_many_attempts", "Too many attempts. Try again in an hour.");
  }

  const supabase = await supabaseForRequest();
  const verified = await supabase.auth.verifyOtp({
    type: "recovery",
    token_hash: parsed.data.tokenHash,
  });
  if (verified.error !== null) {
    await withTransaction(pool, (tx) => registerFailure(tx, key, limit));
    return apiError(410, "link_expired", EXPIRED);
  }

  const raw = (await supabase.auth.getClaims()).data?.claims;
  const claims = sessionClaimsSchema.safeParse(raw);
  const account = claims.success
    ? await one<{ id: string }>(
        pool,
        `select id from public.accounts
          where auth_user_id = $1 and deleted_at is null and status = 'active'`,
        [claims.data.sub],
      )
    : null;
  if (!claims.success || account === null) {
    await supabase.auth.signOut();
    return apiError(410, "link_expired", EXPIRED);
  }

  const result = await setAccountPassword({
    accountId: account.id,
    authUserId: claims.data.sub,
    newPassword: parsed.data.newPassword,
    ip,
    dedupeKey: claims.data.session_id,
    via: "reset_link",
  });
  if (result === "rejected") {
    await supabase.auth.signOut();
    return apiError(422, "password_rejected", "That password cannot be used.", {
      newPassword: "Choose a different password.",
    });
  }

  // The link proved the mailbox and the password is now theirs: this is a sign-in like any
  // other, so it becomes the account's one active session (SPEC §8).
  const claim = await claimSession(pool, new SupabaseAuthProvider(supabase), raw, {
    ip,
    userAgent,
  });
  if (claim.status === "refused") {
    return apiError(
      403,
      claim.reason,
      "Your password is set. Sign in with it to continue.",
    );
  }
  return ok({ next: "app" as const });
}
