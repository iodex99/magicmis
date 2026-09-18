import {
  claimSession,
  neverSignedInAccount,
  provisionAccount,
  refinishAccount,
  sessionClaimsSchema,
  signupRequestSchema,
} from "@magicmis/accounts";
import { z } from "zod";

import { SupabaseAuthProvider } from "@/lib/auth-provider";
import { db } from "@/lib/db";
import { apiError, ok, parseJson, requestMeta } from "@/lib/http";
import { supabaseForRequest } from "@/lib/supabase/server";

/**
 * POST /api/auth/finish — turn a proven identity into an account (ADR 0043).
 *
 * Someone who arrives through Google or Apple for the first time has a verified session and
 * nothing else: no business name, and no accepted terms. This is the second half of sign-up
 * for them — the same two things the password form asks for, recorded the same way, with
 * consent audited by `provisionAccount` exactly as it is for everyone else.
 *
 * The identity comes from the verified session and never from the request body: the caller
 * chooses what their business is called, not whose account this is.
 */
const bodySchema = z.object({
  businessName: signupRequestSchema.shape.businessName,
  acceptTerms: z.literal(true),
  acceptPrivacy: z.literal(true),
});

export async function POST(request: Request): Promise<Response> {
  const parsed = await parseJson(request, bodySchema);
  if (!parsed.ok) return parsed.response;

  const supabase = await supabaseForRequest();
  const raw = (await supabase.auth.getClaims()).data?.claims;
  const claims = sessionClaimsSchema.safeParse(raw);
  if (!claims.success || claims.data.email === undefined) {
    return apiError(
      401,
      "not_signed_in",
      "Sign in again to finish creating your account.",
    );
  }

  const { ip, userAgent } = await requestMeta();
  const pool = db();
  // Only a session that was opened *with* a password is known to have one. Anything else —
  // a provider, or a token that no longer says how it was obtained — is recorded as having
  // none, because that is the direction that fails safely: the worst it can do is offer an
  // emailed link, whereas a wrong "yes" leaves the re-check asking for a password that does
  // not exist, with no way through to export or deletion.
  const hasPassword = (claims.data.amr ?? []).some((m) => m.method === "password");

  // The pre-created, never-signed-in row the callback declined to claim (see there): its
  // owner finishes it here, with their own business name and their own consent.
  const unclaimed = hasPassword
    ? null
    : await neverSignedInAccount(pool, claims.data.sub);
  if (unclaimed !== null) {
    await refinishAccount(pool, {
      accountId: unclaimed,
      businessName: parsed.data.businessName,
      ip,
    });
  }
  const provisioned = await provisionAccount(pool, {
    authUserId: claims.data.sub,
    email: claims.data.email.trim().toLowerCase(),
    // Billing details are asked for at the first purchase, as for every account.
    profile: { ...parsed.data, gstin: undefined },
    ip,
    hasPassword,
  });
  if (provisioned.status === "email_taken") {
    // Never say which: the address belongs to another sign-in method's account.
    return apiError(
      409,
      "cannot_finish",
      "This account could not be created. Sign in the way you did before, or contact support.",
    );
  }

  const claim = await claimSession(pool, new SupabaseAuthProvider(supabase), raw, {
    ip,
    userAgent,
  });
  if (claim.status === "refused") {
    return apiError(403, claim.reason, "Sign-in could not be completed. Try again.");
  }
  return ok({ next: "app" });
}
