import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

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
   * Verification normally establishes a session, and `next` then takes the reader straight
   * on to setting up their authenticator — asking for the password they chose two minutes
   * ago buys nothing. When no session came back (an older link style, a cookie the browser
   * refused), `/sign-in/verified` says what happened and offers the sign-in instead. The
   * destination is decided from what actually happened, not assumed.
   */
  const signedIn =
    !failed && (await supabase.auth.getClaims()).data?.claims !== undefined;
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
