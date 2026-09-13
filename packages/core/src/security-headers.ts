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

/** A per-request nonce: 128 random bits, base64. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * The client IP for rate limits, throttles and the admin allowlist (SPEC §30).
 *
 * Only proxy-added values are trusted. On Vercel, `x-vercel-forwarded-for` is set by the platform
 * and cannot be supplied by the client. Elsewhere the right-most `x-forwarded-for` entry is the
 * one the nearest proxy appended; entries to its left are whatever the client sent. `x-real-ip`
 * is never read: any client can set it. Returns null when there is no trustworthy value.
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
