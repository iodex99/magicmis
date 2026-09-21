/**
 * Response security headers (SPEC §30): a nonce-based Content Security Policy plus HSTS and the usual
 * hardening headers, shared by the customer app and the admin console.
 *
 * Shape follows the Next.js 16 guide (node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md):
 * a fresh nonce per request, `'strict-dynamic'` so scripts loaded by trusted bundles run, and
 * `'wasm-unsafe-eval'` for DuckDB-WASM and libpg-query. Styles allow inline because React server-renders
 * `style` attributes (ECharts containers, widths), which a nonce cannot cover; scripts never do.
 *
 * Razorpay Checkout (https://razorpay.com/docs/payments/payment-gateway/cordova-integration/ whitelists
 * `https://*.razorpay.com`) is allowed only on pages that take payments, so no other page can open it.
 */

export interface SecurityHeaderOptions {
  readonly nonce: string;
  /** `next dev` needs `'unsafe-eval'` for React's error overlays; never in production. */
  readonly development: boolean;
  /** Only over HTTPS: `upgrade-insecure-requests` and HSTS would break plain-HTTP local runs. */
  readonly https: boolean;
  readonly allowPayments: boolean;
}

const RAZORPAY = "https://*.razorpay.com";

export function contentSecurityPolicy(o: SecurityHeaderOptions): string {
  const pay = o.allowPayments ? ` ${RAZORPAY}` : "";
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${o.nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${o.development ? " 'unsafe-eval'" : ""}${pay}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${pay}`,
    "worker-src 'self' blob:",
    `frame-src ${o.allowPayments ? RAZORPAY : "'none'"}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(o.https ? ["upgrade-insecure-requests"] : []),
  ];
  return directives.join("; ");
}

export function securityHeaders(o: SecurityHeaderOptions): Record<string, string> {
  return {
    "content-security-policy": contentSecurityPolicy(o),
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": `camera=(), microphone=(), geolocation=(), payment=(${o.allowPayments ? "self" : ""})`,
    // Razorpay's bank and UPI flows may open a window that reports back.
    "cross-origin-opener-policy": o.allowPayments
      ? "same-origin-allow-popups"
      : "same-origin",
    ...(o.https
      ? { "strict-transport-security": "max-age=63072000; includeSubDomains; preload" }
      : {}),
  };
}

/**
 * Whether the browser reached us over HTTPS, and so whether to send HSTS (SPEC §30, R-55).
 *
 * The parsed URL alone is not enough behind a proxy: the connection from the proxy to the
 * function can be plain, and a header that quietly stops being sent is the worst kind of
 * missing security header — nothing fails, it is simply gone. Vercel documents
 * `x-forwarded-proto` as "the protocol of the forwarded server, typically `https` in
 * production" (https://vercel.com/docs/headers/request-headers, verified 2026-09-16), so
 * either source saying https is enough.
 */
/**
 * How the Supabase auth cookies are written (ADR 0057).
 *
 * `@supabase/ssr` defaults them to `httpOnly: false` with no `Secure`, which is right for an app
 * whose browser code talks to Supabase directly. Nothing here does: there is no browser client
 * anywhere in the tree, every auth call is a server route. So the access and refresh tokens have
 * no reason to be readable from `document.cookie`, where any script that ever runs on the origin
 * could take them — and `authenticated` can read the tenant's rows straight from PostgREST, so a
 * stolen refresh token is not merely a session.
 *
 * `secure` is off in development only, because the local stack and the E2E run are plain HTTP and
 * a browser drops a Secure cookie there.
 */
export const authCookieOptions = (
  environment: "development" | "staging" | "production",
): { httpOnly: true; secure: boolean; sameSite: "lax" } => ({
  httpOnly: true,
  secure: environment !== "development",
  // Lax, not strict: the sign-in confirmation arrives as a top-level GET from the email client,
  // and strict would withhold the cookie that link just established.
  sameSite: "lax",
});

export function isHttps(protocol: string, get: (name: string) => string | null): boolean {
  if (protocol === "https:") return true;
  const forwarded = (get("x-forwarded-proto") ?? "").split(",")[0]?.trim().toLowerCase();
  return forwarded === "https";
}

/** A per-request nonce: 128 random bits, base64. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * The client IP for rate limits, throttles and the admin allowlist (SPEC §30).
 *
 * Only proxy-added values are trusted. Verified against Vercel's request-header reference
 * (https://vercel.com/docs/headers/request-headers, 2026-09-16), which says it "overwrite[s]
 * the X-Forwarded-For header and do[es] not forward external IPs … to prevent IP spoofing",
 * and that `x-vercel-forwarded-for` is the same value except that `x-forwarded-for` "could be
 * overwritten if you're using a proxy on top of Vercel" — so the platform header is read first
 * and is the one that survives a proxy in front.
 *
 * Off Vercel, the right-most `x-forwarded-for` entry is the one the nearest proxy appended;
 * entries to its left are whatever the client sent. `x-real-ip` is never read: Vercel makes it
 * a third copy of the same value, but any client can set it elsewhere, and a header that is
 * only sometimes trustworthy is not. Returns null when there is no trustworthy value.
 */
export function clientIp(get: (name: string) => string | null): string | null {
  const pick = (value: string | null, side: "first" | "last") => {
    const parts = (value ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    const ip = side === "first" ? parts[0] : parts.at(-1);
    return ip !== undefined && /^[0-9a-fA-F:.]{2,45}$/u.test(ip) ? ip : null;
  };
  return (
    pick(get("x-vercel-forwarded-for"), "first") ?? pick(get("x-forwarded-for"), "last")
  );
}
