import { claimSession } from "@magicmis/accounts";
import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { SupabaseAuthProvider } from "@/lib/auth-provider";
import { db } from "@/lib/db";
import { requestMeta } from "@/lib/http";
import { supabaseForRequest } from "@/lib/supabase/server";

/**
 * GET /auth/callback — email verification landing.
 *
 * Handles both link styles Supabase can send: a PKCE `code` to exchange, or a
 * `token_hash` + `type` to verify (https://supabase.com/docs/guides/auth/server-side/nextjs).
 *
 * `next` is restricted to same-origin relative paths, or anyone could craft a verification
 * link that bounces a freshly verified user to a phishing page.
 */
const EMAIL_OTP_TYPES: readonly EmailOtpType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
];

export async function GET(request: NextRequest): Promise<Response> {
  const url = request.nextUrl;
  const requestedNext = url.searchParams.get("next") ?? "/sign-in";
  const next = /^\/(?!\/)[\w\-/]*$/u.test(requestedNext) ? requestedNext : "/sign-in";

  const supabase = await supabaseForRequest();
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const rawType = url.searchParams.get("type");
  const type = EMAIL_OTP_TYPES.find((t) => t === rawType) ?? null;

  let failed = true;
  if (code !== null) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    failed = error !== null;
  } else if (tokenHash !== null && type !== null) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    failed = error !== null;
  }

  /**
   * Where to land.
   *
   * Verification establishes a session, and with the password as the only factor
   * (ADR 0028) there is nothing left to ask for — so the session is **claimed** here, the
   * same as at sign-in. Claiming is what makes it the account's single active one; without
   * it `requireAccount` refuses with `session_not_claimed` and the reader bounces straight
   * back to a sign-in form holding a session they cannot use.
   *
   * When no session came back (an older link style, a cookie the browser refused),
   * `/sign-in/verified` says what happened and offers the sign-in instead. The destination
   * is decided from what actually happened, not assumed.
   */
  const claims = failed ? undefined : (await supabase.auth.getClaims()).data?.claims;
  let signedIn = false;
  if (claims !== undefined) {
    const { ip, userAgent } = await requestMeta();
    const claim = await claimSession(db(), new SupabaseAuthProvider(supabase), claims, {
      ip,
      userAgent,
    });
    signedIn = claim.status !== "refused";
  }
  const path = failed
    ? "/sign-in?verification=failed"
    : signedIn
      ? next
      : "/sign-in/verified";

  /**
   * Redirect to the host the browser actually used.
   *
   * `nextUrl.origin` normalises to `localhost` even when the request arrived on
   * `127.0.0.1`, and the session cookie just written is scoped to the host in the request.
   * Sending the reader to the other spelling drops the cookie on the floor and lands them
   * back at sign-in holding a session they cannot see.
   */
  const host = request.headers.get("host") ?? url.host;
  return NextResponse.redirect(new URL(path, `${url.protocol}//${host}`));
}
