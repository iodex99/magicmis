import { describe, expect, it } from "vitest";

import { contentSecurityPolicy, newNonce, securityHeaders } from "./security-headers";

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
