import { createHash } from "node:crypto";

import {
  checkThrottle,
  clearThrottle,
  registerFailure,
  throttleLimitFor,
} from "@magicmis/accounts";
import { withTransaction } from "@magicmis/db/tx";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, ok, parseJson, requestMeta } from "@/lib/http";
import { supabaseForRequest } from "@/lib/supabase/server";

const bodySchema = z.object({
  email: z.email().transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1).max(128),
});

/**
 * POST /api/auth/sign-in — the password step (aal1).
 *
 * Returns what comes next: TOTP verification, or TOTP enrolment for an account that has
 * never enrolled. A password alone never reaches customer data (migration 0012) and never
 * claims the session (`claimSession` requires aal2).
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

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const next = aal?.nextLevel === "aal2" ? "mfa_verify" : "mfa_enrol";
  return ok({ next });
}
