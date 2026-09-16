import { isHttps, newNonce, securityHeaders } from "@magicmis/core/security-headers";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js 16 proxy: security headers with a per-request CSP nonce (SPEC §30). The console takes no
 * payments and loads nothing from third parties. Authorisation stays in `requireAdmin()` on every page
 * and action; nothing is decided here.
 */
export function proxy(request: NextRequest): NextResponse {
  const headers = securityHeaders({
    nonce: newNonce(),
    development: process.env.NODE_ENV === "development",
    https: isHttps(request.nextUrl.protocol, (n) => request.headers.get(n)),
    allowPayments: false,
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("content-security-policy", headers["content-security-policy"] ?? "");
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  // Every console page shows operational or customer data.
  response.headers.set("cache-control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
