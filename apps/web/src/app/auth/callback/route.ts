import {
  claimSession,
  neverSignedInAccount,
  safeNextPath,
  sessionClaimsSchema,
} from "@magicmis/accounts";
import { randomBytes } from "node:crypto";
import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { SupabaseAuthProvider } from "@/lib/auth-provider";
import { db } from "@/lib/db";
import { requestMeta } from "@/lib/http";
import { OAUTH_NEXT_COOKIE } from "@/lib/server/oauth";
import { supabaseAdmin, supabaseForRequest } from "@/lib/supabase/server";

/**
 * GET /auth/callback — where every link and every identity provider lands: email
 * verification, a password-reset link, and the return from Google or Apple (ADR 0043).
 *
 * Handles both link styles Supabase can send: a PKCE `code` to exchange, or a
 * `token_hash` + `type` to verify (https://supabase.com/docs/guides/auth/server-side/nextjs).
 *
 * `next` is restricted to same-origin relative paths, or anyone could craft a verification
 * link that bounces a freshly verified user to a phishing page.
 */
/**
 * **Only `signup`.** This route establishes a session and claims it, so whatever it accepts is a
 * link that signs its holder in. A reset token must never be one of those (ADR 0043): it is spent
 * on the POST that sets the new password, and it authorises nothing else. While `recovery` was
 * accepted here, anyone holding a reset link — their own, or a victim's seen once in a forwarded
 * mailbox — could turn it into a claimed session without setting a password, and could send a
 * victim a link that quietly signed them into the attacker's account instead of their own.
 *
 * `confirmation.html` is the only template that points here, and it sends `type=signup`. Nothing
 * issues `invite`, `magiclink`, `email_change` or `email`: there is no invitation, no magic-link
 * sign-in, and no way to change an email address in the product at all.
 */
const EMAIL_OTP_TYPES: readonly EmailOtpType[] = ["signup"];

export async function GET(request: NextRequest): Promise<Response> {
  const url = request.nextUrl;
  // A provider return carries no `next`: the identity service only returns to a URL on its
  // allow-list, which is matched exactly, so the start route leaves the destination in a
  // cookie instead (ADR 0043). Validated the same way wherever it came from.
  const carried = request.cookies.get(OAUTH_NEXT_COOKIE)?.value ?? null;
  const next = safeNextPath(
    url.searchParams.get("next") ?? carried,
    carried === null ? "/sign-in" : "/app",
  );

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
  let newcomer = false;
  if (claims !== undefined) {
    const { ip, userAgent } = await requestMeta();
    const parsed = sessionClaimsSchema.safeParse(claims);
    // The auth user, when and only when this session was opened through a provider.
    const providerUser =
      parsed.success && (parsed.data.amr ?? []).some((m) => m.method === "oauth")
        ? parsed.data.sub
        : null;

    /**
     * Someone arriving through Google or Apple, to an account nobody has ever signed in to
     * (ADR 0043). The password form writes the account before the address is proven, so that
     * row may have been left by a stranger who chose its name and its password and is waiting
     * for the owner to walk into it. The provider has now proved who owns the address: any
     * password set before is destroyed, the row is not claimed, and its owner finishes it
     * themselves — their business name, their consent.
     */
    const unclaimed =
      providerUser === null ? null : await neverSignedInAccount(db(), providerUser);
    if (providerUser !== null && unclaimed !== null) {
      await supabaseAdmin().auth.admin.updateUserById(providerUser, {
        password: randomBytes(48).toString("base64url"),
      });
      newcomer = true;
    } else {
      const claim = await claimSession(db(), new SupabaseAuthProvider(supabase), claims, {
        ip,
        userAgent,
      });
      signedIn = claim.status !== "refused";
      // A session with no account behind it is someone who arrived through Google or Apple
      // for the first time: they have proved who they are and have not yet said what to
      // call their business or accepted the terms. The finish step asks for exactly that.
      newcomer = claim.status === "refused" && claim.reason === "no_account";
    }
  }
  const path = failed
    ? "/sign-in?verification=failed"
    : signedIn
      ? next
      : newcomer
        ? "/sign-up/finish"
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
  const response = NextResponse.redirect(new URL(path, `${url.protocol}//${host}`));
  if (carried !== null) response.cookies.delete(OAUTH_NEXT_COOKIE);
  return response;
}
