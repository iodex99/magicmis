import { apiError, currentClaims, ok } from "@/lib/http";
import { supabaseForRequest } from "@/lib/supabase/server";

/**
 * POST /api/auth/mfa/enrol — start TOTP enrolment (SPEC §8: 2FA is mandatory).
 *
 * Only for a signed-in user without a verified factor. Abandoned, unverified factors from
 * an earlier attempt are removed first, so a user who closed the tab mid-enrolment is not
 * stuck behind the per-user factor limit.
 */
export async function POST(): Promise<Response> {
  if ((await currentClaims()) === null) {
    return apiError(
      401,
      "not_signed_in",
      "Sign in first, then set up your authenticator app.",
    );
  }
  const supabase = await supabaseForRequest();

  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError !== null) {
    return apiError(
      503,
      "mfa_unavailable",
      "Two-factor setup is temporarily unavailable. Try again shortly.",
    );
  }
  if (factors.totp.length > 0) {
    return apiError(
      409,
      "already_enrolled",
      "An authenticator is already set up. Enter its 6-digit code instead.",
    );
  }
  for (const stale of factors.all.filter(
    (f) => f.factor_type === "totp" && f.status !== "verified",
  )) {
    await supabase.auth.mfa.unenroll({ factorId: stale.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
  if (error !== null) {
    return apiError(
      503,
      "mfa_unavailable",
      "Two-factor setup is temporarily unavailable. Try again shortly.",
    );
  }

  return ok({
    factorId: data.id,
    // An SVG data URL rendered by the page. The secret is shown for manual entry and is
    // never stored by this product.
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  });
}
