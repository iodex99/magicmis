import { createHash } from "node:crypto";

import {
  claimAttempt,
  provisionAccount,
  signupRequestSchema,
  throttleLimitFor,
} from "@magicmis/accounts";

import { db } from "@/lib/db";
import { appPublicEnv } from "@/lib/env";
import { apiError, ok, parseJson, requestMeta } from "@/lib/http";
import { supabaseForRequest } from "@/lib/supabase/server";

/**
 * POST /api/auth/sign-up (SPEC §8).
 *
 * Always answers "check your email" for a well-formed request, whether or not the address
 * is already registered: revealing which emails have accounts would let anyone enumerate
 * a CA firm's client list by trying addresses.
 */
export async function POST(request: Request): Promise<Response> {
  const parsed = await parseJson(request, signupRequestSchema);
  if (!parsed.ok) return parsed.response;
  const input = parsed.data;
  const { ip } = await requestMeta();
  const pool = db();

  // Throttle sign-up attempts per IP. Every attempt counts, successful or not.
  const limit = await throttleLimitFor(pool, "signup");
  const key = `signup:ip:${ip ?? "unknown"}`;
  // One locked decision: check and count together, or a burst passes the limit (ADR 0058).
  if ((await claimAttempt(pool, [key], limit)).locked) {
    return apiError(
      429,
      "too_many_attempts",
      "Too many sign-up attempts from this network. Try again later.",
    );
  }

  const supabase = await supabaseForRequest();
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      // The callback establishes a session and the password is the only factor, so a
      // verified user goes straight into the app rather than back to a sign-in form.
      emailRedirectTo: `${appPublicEnv().NEXT_PUBLIC_APP_URL}/auth/callback?next=/app`,
    },
  });

  if (error !== null) {
    if (error.code === "weak_password") {
      return apiError(422, "weak_password", "Choose a stronger password.", {
        password:
          "Use at least 12 characters with upper- and lower-case letters and a digit.",
      });
    }
    // Other failures (rate limit, provider error) must not reveal account existence either.
    return apiError(
      503,
      "signup_unavailable",
      "Sign-up is temporarily unavailable. Try again in a few minutes.",
    );
  }

  // With email confirmation on, an existing address returns a user with no identities
  // rather than an error (anti-enumeration). Only provision genuinely new users.
  const user = data.user;
  if (user !== null && (user.identities?.length ?? 0) > 0) {
    const { businessName, gstin, billingAddress, acceptTerms, acceptPrivacy } = input;
    await provisionAccount(pool, {
      authUserId: user.id,
      email: input.email,
      profile: { businessName, gstin, billingAddress, acceptTerms, acceptPrivacy },
      ip,
    });
  }

  return ok({
    status: "check_email",
    // A hash, not the address, so logs of this response never contain the email.
    ref: createHash("sha256").update(input.email).digest("hex").slice(0, 12),
  });
}
