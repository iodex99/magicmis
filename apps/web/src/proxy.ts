import { isDesktopUserAgent, isDeviceAgnosticPath } from "@magicmis/accounts/desktop";
import { newNonce, securityHeaders } from "@magicmis/core/security-headers";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js 16 proxy (formerly middleware; https://nextjs.org/docs/app/api-reference/file-conventions/proxy).
 *
 * Three jobs, all cheap and none touching the database (ADR 0006: proxy may run outside
 * the database region):
 *
 * 1. Security headers with a per-request CSP nonce (SPEC §30). Next.js reads the nonce from the
 *    request's CSP header and applies it to its own scripts; every page renders dynamically.
 * 2. Refresh Supabase auth cookies, per https://supabase.com/docs/guides/auth/server-side/nextjs.
 * 3. The desktop-only gate (SPEC §2.13).
 *
 * Authorisation is NOT decided here. Next.js warns that a matcher change can silently
 * drop proxy coverage, so every route handler and server page checks `requireAccount()`
 * itself; this file only improves the experience of unauthenticated navigation.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const headers = securityHeaders({
    nonce: newNonce(),
    development: process.env.NODE_ENV === "development",
    https: request.nextUrl.protocol === "https:",
    // SPEC §30: the payment gateway only where credits are bought.
    allowPayments: pathname === "/wallet" || pathname.startsWith("/wallet/"),
  });
  const secure = (response: NextResponse): NextResponse => {
    for (const [name, value] of Object.entries(headers))
      response.headers.set(name, value);
    return response;
  };
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("content-security-policy", headers["content-security-policy"] ?? "");
  const next = () => NextResponse.next({ request: { headers: requestHeaders } });

  if (
    !isDeviceAgnosticPath(pathname) &&
    !pathname.startsWith("/api/") &&
    !isDesktopUserAgent(request.headers.get("user-agent"))
  ) {
    return secure(
      NextResponse.rewrite(new URL("/desktop-required", request.url), {
        request: { headers: requestHeaders },
      }),
    );
  }

  let response = next();
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const key = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
  if (url === undefined || key === undefined) return secure(response);

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(toSet) {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        requestHeaders.set("cookie", request.headers.get("cookie") ?? "");
        response = next();
        for (const { name, value, options } of toSet)
          response.cookies.set(name, value, options);
      },
    },
  });

  // Refreshes an expired access token using the refresh token, writing new cookies.
  const { data } = await supabase.auth.getClaims();

  const protectedPath =
    pathname.startsWith("/app") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/wallet");
  if (protectedPath && data === null) {
    const signIn = new URL("/sign-in", request.url);
    signIn.searchParams.set("next", pathname);
    return secure(NextResponse.redirect(signIn));
  }

  // Authenticated pages carry customer data; never let a CDN cache them.
  if (protectedPath) response.headers.set("cache-control", "private, no-store");
  return secure(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
