import { createHash } from "node:crypto";

import { claimAttempt, throttleLimitFor } from "@magicmis/accounts";
import { after } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, ok, parseJson, requestMeta } from "@/lib/http";
import { ephemeralSupabase } from "@/lib/supabase/server";

/**
 * POST /api/auth/forgot — email a link that sets a new password (SPEC §8, ADR 0043).
 *
 * The answer is the same whether or not the address has an account: telling them apart would
 * let anyone test which firms are customers. The link carries a one-use token to
 * `/reset-password`, where it is spent together with the new password (`/api/auth/reset`).
 *
 * Every request counts against the throttle, successful or not: the cost being limited is
 * the email, and that is sent either way.
 */
const bodySchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.trim().toLowerCase()),
});

export async function POST(request: Request): Promise<Response> {
  const parsed = await parseJson(request, bodySchema);
  if (!parsed.ok) return parsed.response;
  const { email } = parsed.data;
  const { ip } = await requestMeta();
  const pool = db();

  const limit = await throttleLimitFor(pool, "password_reset");
  const byNetwork = `password_reset:ip:${ip ?? "unknown"}`;
  const byAddress = `password_reset:email:${createHash("sha256").update(email).digest("hex")}`;

  // The network asking can be told to stop. The address being asked about cannot: whoever
  // is typing it may not own it, and a lock an anonymous caller can place on someone else's
  // address would shut an account that signs in with Google out of the only way it has to
  // set a password — and with it out of export and deletion. So past the limit for an
  // address the email is quietly not sent, the answer stays the same, and nothing is
  // recorded that a caller could keep extending.
  // Both counted as they are checked (ADR 0058). The network's key decides the answer; the
  // address's key only decides whether an email goes out, and running out of it is silent.
  if ((await claimAttempt(pool, [byNetwork], limit)).locked) {
    return apiError(
      429,
      "too_many_attempts",
      "Too many reset requests. Wait an hour, then try again.",
    );
  }
  const addressSpent = (await claimAttempt(pool, [byAddress], limit)).locked;

  // Sent after the response has gone, so how long the answer takes says nothing about
  // whether the address has an account. No cookies are involved: the emailed link is the
  // token-hash style (supabase/templates/recovery.html), not bound to this browser.
  if (!addressSpent) {
    after(async () => {
      await ephemeralSupabase().auth.resetPasswordForEmail(email);
    });
  }

  return ok({ status: "sent_if_exists" });
}
