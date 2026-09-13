import { isDesktopUserAgent, isDeviceAgnosticPath } from "@magicmis/accounts/desktop";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js 16 proxy (formerly middleware; https://nextjs.org/docs/app/api-reference/file-conventions/proxy).
 *
 * Two jobs, both cheap and neither touching the database (ADR 0006: proxy may run outside
 * the database region):
 *
 * 1. Refresh Supabase auth cookies, per https://supabase.com/docs/guides/auth/server-side/nextjs.
 * 2. The desktop-only gate (SPEC §2.13).
 *
 * Authorisation is NOT decided here. Next.js warns that a matcher change can silently
 * drop proxy coverage, so every route handler and server page checks `requireAccount()`
 * itself; this file only improves the experience of unauthenticated navigation.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (
    !isDeviceAgnosticPath(pathname) &&
    !pathname.startsWith("/api/") &&
    !isDesktopUserAgent(request.headers.get("user-agent"))
  ) {
    return NextResponse.rewrite(new URL("/desktop-required", request.url));
  }

  let response = NextResponse.next({ request });
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const key = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
  if (url === undefined || key === undefined) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(toSet) {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet)
          response.cookies.set(name, value, options);
      },
    },
  });

  // Refreshes an expired access token using the refresh token, writing new cookies.
  const { data } = await supabase.auth.getClaims();

  const protectedPath = pathname.startsWith("/app") || pathname.startsWith("/settings");
  if (protectedPath && data === null) {
    const signIn = new URL("/sign-in", request.url);
    signIn.searchParams.set("next", pathname);
    return NextResponse.redirect(signIn);
  }

  // Authenticated pages carry customer data; never let a CDN cache them.
  if (protectedPath) response.headers.set("cache-control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
