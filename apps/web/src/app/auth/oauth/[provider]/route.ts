import { safeNextPath } from "@magicmis/accounts";
import { NextResponse, type NextRequest } from "next/server";

import { appPublicEnv } from "@/lib/env";
import { isEnabledProvider, OAUTH_NEXT_COOKIE } from "@/lib/server/oauth";
import { supabaseForRequest } from "@/lib/supabase/server";

/**
 * GET /auth/oauth/:provider — start signing in with Google or Apple (ADR 0043).
 *
 * The PKCE flow from https://supabase.com/docs/guides/auth/social-login/auth-google: ask
 * Supabase for the provider's authorisation URL, which also writes the code verifier into
 * this browser's cookies, and send the browser there. The provider returns to Supabase and
 * Supabase returns to `/auth/callback` with a code — the same landing the email link uses —
 * where the session is exchanged and claimed.
 *
 * A plain link, not a form post: starting a sign-in changes nothing on our side, and PKCE with
 * the provider's `state` is what stops a forged return. A provider that is not switched on
 * does not exist, as far as this route is concerned.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await context.params;
  if (!isEnabledProvider(provider)) return new NextResponse("Not found", { status: 404 });

  const next = safeNextPath(request.nextUrl.searchParams.get("next"), "/app");
  const origin = appPublicEnv().NEXT_PUBLIC_APP_URL.replace(/\/+$/u, "");
  const supabase = await supabaseForRequest();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      // Exactly the allow-listed URL, with no query: the identity service matches its
      // allow-list against the whole URL and quietly falls back to the site root on a miss,
      // where nothing exchanges the code. The destination travels in a cookie instead —
      // widening the allow-list to a pattern is how an open redirect gets introduced.
      redirectTo: `${origin}/auth/callback`,
      skipBrowserRedirect: true,
    },
  });

  if (error !== null) {
    const back = new URL("/sign-in", origin);
    back.searchParams.set("provider", "unavailable");
    return NextResponse.redirect(back);
  }
  const response = NextResponse.redirect(data.url);
  response.cookies.set(OAUTH_NEXT_COOKIE, next, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/auth/callback",
    maxAge: 600,
  });
  return response;
}
