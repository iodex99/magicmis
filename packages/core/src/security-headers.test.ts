import { describe, expect, it } from "vitest";

import {
  clientIp,
  contentSecurityPolicy,
  newNonce,
  securityHeaders,
} from "./security-headers";

const base = { nonce: "abc123==", development: false, https: true, allowPayments: false };

describe("security headers (SPEC §30)", () => {
  it("allows only nonce-bearing scripts, and no eval in production", () => {
    const csp = contentSecurityPolicy(base);
    expect(csp).toContain(
      "script-src 'self' 'nonce-abc123==' 'strict-dynamic' 'wasm-unsafe-eval'",
    );
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/u);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(contentSecurityPolicy({ ...base, development: true })).toContain(
      "'unsafe-eval'",
    );
  });

  it("opens Razorpay only where payments are taken", () => {
    expect(contentSecurityPolicy(base)).not.toContain("razorpay");
    expect(contentSecurityPolicy(base)).toContain("frame-src 'none'");
    const pay = contentSecurityPolicy({ ...base, allowPayments: true });
    expect(pay).toContain("frame-src https://*.razorpay.com");
    expect(pay).toMatch(/connect-src 'self' https:\/\/\*\.razorpay\.com/u);
  });

  it("sends HSTS and upgrades requests only over HTTPS", () => {
    expect(securityHeaders(base)["strict-transport-security"]).toContain(
      "max-age=63072000",
    );
    const local = securityHeaders({ ...base, https: false });
    expect(local["strict-transport-security"]).toBeUndefined();
    expect(local["content-security-policy"]).not.toContain("upgrade-insecure-requests");
    expect(local["x-frame-options"]).toBe("DENY");
  });

  it("makes a fresh, unguessable nonce each time", () => {
    const a = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/u);
    expect(newNonce()).not.toBe(a);
  });
});

describe("client IP (SPEC §30)", () => {
  const from = (h: Record<string, string>) => clientIp((name) => h[name] ?? null);

  it("trusts the platform header, then the proxy-appended forwarded entry, never x-real-ip", () => {
    expect(
      from({ "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "6.6.6.6" }),
    ).toBe("203.0.113.7");
    // A client-supplied spoof sits on the left; the proxy appends the real address on the right.
    expect(from({ "x-forwarded-for": "6.6.6.6, 198.51.100.4" })).toBe("198.51.100.4");
    expect(from({ "x-real-ip": "6.6.6.6" })).toBeNull();
    expect(from({ "x-forwarded-for": "not-an-ip<script>" })).toBeNull();
    expect(from({ "x-forwarded-for": "2001:db8::1" })).toBe("2001:db8::1");
    expect(from({})).toBeNull();
  });
});
