import { redeemBackupCode } from "@magicmis/accounts";
import { z } from "zod";

import { SupabaseAuthProvider } from "@/lib/auth-provider";
import { db } from "@/lib/db";
import { apiError, currentClaims, ok, parseJson, requestMeta } from "@/lib/http";
import { supabaseForRequest } from "@/lib/supabase/server";

const bodySchema = z.object({ code: z.string().min(1).max(20) });

/**
 * POST /api/auth/backup-code — recovery when the authenticator is lost (SPEC §8).
 *
 * Requires the password step. A valid code removes the account's TOTP factors; Supabase
 * then signs the user out everywhere (documented on `admin.mfa.deleteFactor` in
 * @supabase/auth-js 2.116.0), so the next step is to sign in again and enrol a new
 * authenticator. The code never grants access by itself.
 */
export async function POST(request: Request): Promise<Response> {
  const parsed = await parseJson(request, bodySchema);
  if (!parsed.ok) return parsed.response;
  const claims = await currentClaims();
  if (claims === null)
    return apiError(401, "not_signed_in", "Enter your email and password first.");

  const { ip } = await requestMeta();
  const supabase = await supabaseForRequest();
  const result = await redeemBackupCode(
    db(),
    new SupabaseAuthProvider(supabase),
    claims,
    {
      code: parsed.data.code,
      ip,
    },
  );

  switch (result.status) {
    case "factors_reset":
      return ok({
        status: "factors_reset",
        message: "Backup code accepted. Sign in again to set up a new authenticator app.",
      });
    case "invalid_code":
      return apiError(
        401,
        "invalid_code",
        `That backup code is not valid. ${String(result.attemptsRemaining)} attempts left.`,
      );
    case "locked":
      return apiError(
        429,
        "too_many_attempts",
        "Too many incorrect backup codes. Try again after an hour, or contact support.",
      );
    case "refused":
      return apiError(401, result.reason, "Sign in again to continue.");
  }
}
