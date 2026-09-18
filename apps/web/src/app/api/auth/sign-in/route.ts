import { createHash } from "node:crypto";

import {
  checkThrottle,
  claimSession,
  clearThrottle,
  registerFailure,
  throttleLimitFor,
} from "@magicmis/accounts";
import { withTransaction } from "@magicmis/db/tx";
import { z } from "zod";

import { SupabaseAuthProvider } from "@/lib/auth-provider";
import { db } from "@/lib/db";
import { apiError, ok, parseJson, requestMeta } from "@/lib/http";
import { supabaseForRequest } from "@/lib/supabase/server";

const bodySchema = z.object({
  email: z.email().transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1).max(128),
});

/**
 * POST /api/auth/sign-in — the whole of signing in (SPEC §8, ADR 0028).
 *
 * The password is the only factor. On success this claims the session, which makes it the
 * account's single active one and cuts off any other tab, and records the login.
 *
 * With no second factor, the throttle above is what stands between a leaked password list
 * and an account: it counts every attempt per IP and per email, and locks on the limit.
 */
export async function POST(request: Request): Promise<Response> {
  const parsed = await parseJson(request, bodySchema);
  if (!parsed.ok) return parsed.response;
  const { email, password } = parsed.data;
  const { ip, userAgent } = await requestMeta();
  const pool = db();

  const limit = await throttleLimitFor(pool, "sign_in");
  // The email is hashed in the key: auth_throttle is operator-readable and must not become
  // a list of addresses people tried.
  const keys = [
    `sign_in:ip:${ip ?? "unknown"}`,
    `sign_in:email:${createHash("sha256").update(email).digest("hex")}`,
  ];
  for (const key of keys) {
    const state = await checkThrottle(pool, key);
    if (state.locked) {
      return apiError(
        429,
        "too_many_attempts",
        "Too many sign-in attempts. Wait 15 minutes, then try again.",
      );
    }
  }

  const supabase = await supabaseForRequest();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error !== null) {
    if (error.code === "email_not_confirmed") {
      return apiError(
        403,
        "email_not_verified",
        "Verify your email address first. Check your inbox for the link.",
      );
    }
    await withTransaction(pool, async (tx) => {
      for (const key of keys) await registerFailure(tx, key, limit);
      const account = await tx.query<{ id: string }>(
        `select id from public.accounts where lower(email) = $1 and deleted_at is null`,
        [email],
      );
      const accountId = account.rows[0]?.id;
      if (accountId !== undefined) {
        await tx.query(
          `insert into public.login_events (account_id, event_type, ip, user_agent) values ($1, 'failed', $2, $3)`,
          [accountId, ip, userAgent],
        );
      }
    });
    // Same message whether the email exists or the password is wrong.
    return apiError(401, "invalid_credentials", "The email or password is incorrect.");
  }

  for (const key of keys) await clearThrottle(pool, key);

  const { data: after } = await supabase.auth.getClaims();
  const claim = await claimSession(
    pool,
    new SupabaseAuthProvider(supabase),
    after?.claims,
    { ip, userAgent },
  );
  // ADR 0043: signed in, but the account row was never created (someone who came through
  // Google or Apple and closed the tab before finishing). The finish step completes it.
  if (claim.status === "refused" && claim.reason === "no_account") {
    return ok({ next: "finish" as const });
  }
  if (claim.status === "refused") {
    return apiError(
      403,
      claim.reason,
      claim.reason === "account_not_active"
        ? "This account is closed. Contact support if you think that is wrong."
        : "Sign-in could not be completed. Try again.",
    );
  }
  return ok({ next: "app" as const });
}
