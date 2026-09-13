import { apiError, currentClaims, ok } from "@/lib/http";
import { supabaseForRequest } from "@/lib/supabase/server";

/** GET /api/auth/mfa/factor — the signed-in user's verified TOTP factor id, if any. */
export async function GET(): Promise<Response> {
  if ((await currentClaims()) === null)
    return apiError(401, "not_signed_in", "Sign in first.");
  const supabase = await supabaseForRequest();
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error !== null) {
    return apiError(
      503,
      "mfa_unavailable",
      "Two-factor verification is temporarily unavailable.",
    );
  }
  const factor = data.totp[0];
  return ok(
    factor === undefined ? { enrolled: false } : { enrolled: true, factorId: factor.id },
  );
}
