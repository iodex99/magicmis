import { claimSession, issueBackupCodes } from "@magicmis/accounts";
import { z } from "zod";

import { SupabaseAuthProvider } from "@/lib/auth-provider";
import { db } from "@/lib/db";
import { apiError, idempotent, parseJson, requestMeta } from "@/lib/http";
import { supabaseForRequest } from "@/lib/supabase/server";

const bodySchema = z.object({
  factorId: z.uuid(),
  code: z
    .string()
    .regex(/^\d{6}$/u, "Enter the 6-digit code from your authenticator app"),
});

/**
 * POST /api/auth/mfa/verify — the second factor. Reaching aal2 here is the only way into
 * the app (SPEC §8).
 *
 * On success: issue backup codes if this is the account's first enrolment (returned once,
 * never stored in plaintext, never replayed), then claim this session as the account's
 * single active session, which cuts off any other.
 */
export async function POST(request: Request): Promise<Response> {
  const parsed = await parseJson(request, bodySchema);
  if (!parsed.ok) return parsed.response;
  const { factorId, code } = parsed.data;
  const supabase = await supabaseForRequest();
  const { ip, userAgent } = await requestMeta();

  const { data: before } = await supabase.auth.getClaims();
  const sub = typeof before?.claims.sub === "string" ? before.claims.sub : null;
  if (sub === null) return apiError(401, "not_signed_in", "Sign in first.");

  return idempotent(request, `user:${sub}`, { factorId, code }, async () => {
    const verified = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (verified.error !== null) {
      return {
        status: 401,
        body: {
          error: "invalid_code",
          message: "That code is not valid. Check your authenticator app and try again.",
        },
      };
    }

    // Read the new aal2 token directly: cookies written by this same request are not
    // reliably visible to a re-read within it.
    const { data: after, error } = await supabase.auth.getClaims(
      verified.data.access_token,
    );
    if (error !== null || after === null) {
      return {
        status: 503,
        body: { error: "session_unavailable", message: "Try signing in again." },
      };
    }

    const pool = db();
    const account = await pool.query<{ id: string; ever_issued: boolean }>(
      `select a.id, exists (select 1 from public.backup_codes b where b.account_id = a.id) as ever_issued
       from public.accounts a where a.auth_user_id = $1 and a.deleted_at is null`,
      [sub],
    );
    const row = account.rows[0];
    if (row === undefined) {
      return {
        status: 403,
        body: {
          error: "no_account",
          message: "This sign-in has no account. Contact support.",
        },
      };
    }

    const backupCodes = row.ever_issued
      ? null
      : await issueBackupCodes(pool, row.id, { ip, reason: "enrolment" });

    const claim = await claimSession(
      pool,
      new SupabaseAuthProvider(supabase),
      after.claims,
      { ip, userAgent },
    );
    if (claim.status === "refused") {
      return {
        status: 403,
        body: {
          error: claim.reason,
          message: "This account cannot sign in right now. Contact support.",
        },
      };
    }

    return {
      status: 200,
      body: { status: "signed_in", backupCodes },
      containsSecret: backupCodes !== null,
    };
  });
}
