import { createHash } from "node:crypto";

import { claimAttempt, throttleLimitFor } from "@magicmis/accounts";
import { z } from "zod";

import { db } from "@/lib/db";
import { appPublicEnv } from "@/lib/env";
import { apiError, ok, parseJson, requestMeta } from "@/lib/http";
import { openingSoon, prelaunch } from "@/lib/server/prelaunch";
import { supabaseForRequest } from "@/lib/supabase/server";

const bodySchema = z.object({ email: z.email().max(320) }).strict();

/**
 * POST /api/auth/resend — sends the sign-up confirmation again (ADR 0091).
 *
 * The link it sends is the same kind sign-up sent: it signs in only the browser holding the
 * sign-up cookie (ADR 0071), so a resend changes nothing about who it can sign in. It answers
 * the same whether or not the address has an account, as sign-up does, and it is counted in
 * sign-up's own buckets — per network, and per address so nobody can fill a stranger's inbox.
 * Verified against @supabase/auth-js 2.116.0: `auth.resend({ type: "signup", email, options:
 * { emailRedirectTo } })` (https://supabase.com/docs/reference/javascript/auth-resend).
 */
export async function POST(request: Request): Promise<Response> {
  if (prelaunch()) return openingSoon();
  const parsed = await parseJson(request, bodySchema);
  if (!parsed.ok) return parsed.response;
  const email = parsed.data.email.trim().toLowerCase();
  const { ip } = await requestMeta();
  const pool = db();

  const limit = await throttleLimitFor(pool, "signup");
  const keys = [
    `signup:ip:${ip ?? "unknown"}`,
    `resend:email:${createHash("sha256").update(email).digest("hex")}`,
  ];
  if ((await claimAttempt(pool, keys, limit)).locked)
    return apiError(
      429,
      "too_many_attempts",
      "That address has had several emails already. Wait a little, then try again.",
    );

  const supabase = await supabaseForRequest();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: {
      emailRedirectTo: `${appPublicEnv().NEXT_PUBLIC_APP_URL}/auth/callback?next=/app`,
    },
  });
  if (error !== null)
    // The code only, never the address (ADR 0073); and the answer stays the same, so a failure
    // says nothing about whether the address has an account.
    console.error("auth_email: resend failed", {
      code: error.code ?? null,
      status: error.status ?? null,
    });
  return ok({ status: "sent" });
}
