import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { isDesktopUserAgent, isDeviceAgnosticPath } from "./desktop";
import { invoiceableMessage, isInvoiceable, unrenderable } from "./invoiceable";
import { isSafeNextPath, safeNextPath } from "./redirect";
import { describeUserAgent, deviceFingerprintHash, normaliseUserAgent } from "./device";
import { placeOfSupplyState, signupProfileSchema, signupRequestSchema } from "./signup";
import { GST_STATE_CODES, isGstStateCode } from "./state-codes";

const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const CHROME_WIN_NEXT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.54 Safari/537.36";
const FIREFOX_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID_TABLET =
  "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

describe("device fingerprinting (SPEC §8 new-device alerts)", () => {
  it("treats a browser auto-update as the same device", () => {
    expect(normaliseUserAgent(CHROME_WIN)).toBe(normaliseUserAgent(CHROME_WIN_NEXT));
    expect(deviceFingerprintHash("acct-1", CHROME_WIN)).toBe(
      deviceFingerprintHash("acct-1", CHROME_WIN_NEXT),
    );
  });

  it("distinguishes different browsers", () => {
    expect(deviceFingerprintHash("acct-1", CHROME_WIN)).not.toBe(
      deviceFingerprintHash("acct-1", FIREFOX_MAC),
    );
  });

  it("hashes the same browser differently for different accounts", () => {
    // The stored value must not let anyone link two accounts to one person.
    expect(deviceFingerprintHash("acct-1", CHROME_WIN)).not.toBe(
      deviceFingerprintHash("acct-2", CHROME_WIN),
    );
  });

  it("describes a user agent for login history", () => {
    expect(describeUserAgent(CHROME_WIN)).toBe("Chrome on Windows");
    expect(describeUserAgent(FIREFOX_MAC)).toBe("Firefox on macOS");
    expect(describeUserAgent("Mozilla/5.0 Edg/140.0")).toBe("Edge on Unknown OS");
  });
});

describe("desktop-only gate (SPEC §2.13)", () => {
  it("allows desktop browsers", () => {
    expect(isDesktopUserAgent(CHROME_WIN)).toBe(true);
    expect(isDesktopUserAgent(FIREFOX_MAC)).toBe(true);
  });

  it("gates phones and tablets", () => {
    expect(isDesktopUserAgent(IPHONE)).toBe(false);
    expect(isDesktopUserAgent(ANDROID_TABLET)).toBe(false);
  });

  it("does not gate a request with no user agent", () => {
    expect(isDesktopUserAgent(undefined)).toBe(true);
    expect(isDesktopUserAgent("")).toBe(true);
  });

  it("keeps marketing, help, legal and webhooks reachable on any device", () => {
    for (const path of [
      "/",
      "/pricing",
      "/help/tally",
      "/legal/privacy",
      "/api/webhooks/razorpay",
    ]) {
      expect(isDeviceAgnosticPath(path), path).toBe(true);
    }
    for (const path of ["/app", "/app/companies", "/wallet", "/api/jobs"]) {
      expect(isDeviceAgnosticPath(path), path).toBe(false);
    }
  });

  it("does not let '/' make every path device-agnostic", () => {
    expect(isDeviceAgnosticPath("/anything")).toBe(false);
  });
});

describe("signup validation (SPEC §8)", () => {
  const base = {
    email: "Owner@Example.test",
    password: "CorrectHorse42battery",
    businessName: "Sharma & Associates",
    billingAddress: {
      line1: "12 MG Road",
      city: "Pune",
      country: "IN",
      postalCode: "411001",
      stateCode: "27",
    },
    acceptTerms: true,
    acceptPrivacy: true,
  };

  it("accepts a complete request and lower-cases the email", () => {
    const parsed = signupRequestSchema.parse(base);
    expect(parsed.email).toBe("owner@example.test");
    expect(parsed.gstin).toBeUndefined();
  });

  it("requires consent to both documents", () => {
    expect(signupRequestSchema.safeParse({ ...base, acceptTerms: false }).success).toBe(
      false,
    );
    expect(
      signupRequestSchema.safeParse({ ...base, acceptPrivacy: undefined }).success,
    ).toBe(false);
  });

  it("enforces the password policy server-side too", () => {
    for (const weak of [
      "short1A",
      "alllowercase123",
      "ALLUPPERCASE123",
      "NoDigitsHereAtAll",
    ]) {
      expect(
        signupRequestSchema.safeParse({ ...base, password: weak }).success,
        weak,
      ).toBe(false);
    }
  });

  it("validates GSTIN format and checksum, normalising pasted input", () => {
    expect(signupRequestSchema.parse({ ...base, gstin: " 27aapfu0939f1zv " }).gstin).toBe(
      "27AAPFU0939F1ZV",
    );
    expect(
      signupRequestSchema.safeParse({ ...base, gstin: "27AAPFU0939F1ZA" }).success,
    ).toBe(false);
    expect(signupRequestSchema.parse({ ...base, gstin: "" }).gstin).toBeUndefined();
  });

  it("rejects unknown states and malformed PIN codes", () => {
    expect(
      signupRequestSchema.safeParse({
        ...base,
        billingAddress: { ...base.billingAddress, stateCode: "28" },
      }).success,
    ).toBe(false);
    for (const postalCode of ["011001", "41100", "4110011", "ABCDEF"]) {
      expect(
        signupRequestSchema.safeParse({
          ...base,
          billingAddress: { ...base.billingAddress, postalCode },
        }).success,
        postalCode,
      ).toBe(false);
    }
  });

  it("takes place of supply from the GSTIN when present, else the billing state (SPEC §13)", () => {
    const withGstin = signupProfileSchema.parse({ ...base, gstin: "29AAGCB7383J1Z4" });
    expect(placeOfSupplyState(withGstin)).toBe("29");
    expect(placeOfSupplyState(signupProfileSchema.parse(base))).toBe("27");
  });
});

describe("GST state codes", () => {
  it("matches the e-invoice master: 01-38 without 28, plus 97", () => {
    const codes = Object.keys(GST_STATE_CODES);
    expect(codes).toContain("01");
    expect(codes).toContain("38");
    expect(codes).toContain("97");
    expect(codes).not.toContain("28");
    expect(codes).toHaveLength(38);
  });

  it("property: every listed code is two digits", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...Object.keys(GST_STATE_CODES)),
        (code) => /^\d{2}$/u.test(code) && isGstStateCode(code),
      ),
    );
  });

  it("rejects prototype keys", () => {
    expect(isGstStateCode("toString")).toBe(false);
    expect(isGstStateCode("__proto__")).toBe(false);
  });
});

describe("post-authentication redirect (SPEC §8, §30)", () => {
  it("accepts only same-origin absolute paths", () => {
    for (const ok of ["/app", "/app/data", "/settings/security", "/wallet", "/"]) {
      expect(isSafeNextPath(ok), ok).toBe(true);
    }
  });

  it("refuses every shape that leaves this origin", () => {
    // Each of these has been a real open-redirect in some product. `/\host` matters
    // most here: it starts with a single slash, so a naive startsWith("/") lets it past,
    // and browsers resolve it as a network-path reference to another origin.
    const hostile = [
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "http://evil.example",
      "//evil.example/app",
      "/\\/evil.example",
      "javascript:alert(1)",
      "app",
      "",
      " /app",
    ];
    for (const bad of hostile) {
      expect(isSafeNextPath(bad), bad).toBe(false);
      expect(safeNextPath(bad, "/app"), bad).toBe("/app");
    }
    expect(safeNextPath(null, "/app")).toBe("/app");
    expect(safeNextPath(undefined, "/sign-in")).toBe("/sign-in");
  });

  it("never returns anything that is not a path, for any input", () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const out = safeNextPath(raw, "/app");
        expect(out.startsWith("/")).toBe(true);
        expect(out.startsWith("//")).toBe(false);
        expect(out.startsWith("/\\")).toBe(false);
      }),
    );
  });
});

describe("text that reaches a tax invoice (SPEC §13, R-25)", () => {
  it("accepts everything the invoice font can actually draw", () => {
    for (const ok of [
      "Iyer & Co Chartered Accountants",
      "Café Ledger Pvt Ltd",
      "Naïve Söhne (India) Pvt. Ltd.",
      "4 Park Street, 2nd Floor",
      "Cost: ¥ £ ¢ ± µ ÷",
      "",
    ]) {
      expect(isInvoiceable(ok), ok).toBe(true);
      expect(invoiceableMessage(ok), ok).toBe("");
    }
  });

  it("refuses scripts the font has no glyphs for, and says which characters", () => {
    // Each of these would have been drawn as "?" on a legal document.
    for (const bad of ["आनंद ट्रेडिंग", "अ", "海外貿易", "Ledger ☺", "Emoji 🙂 Co"]) {
      expect(isInvoiceable(bad), bad).toBe(false);
      expect(invoiceableMessage(bad)).toContain("cannot be used here");
    }
    expect(unrenderable("अOK आ")).toEqual(["अ", "आ"]);
    // De-duplicated, so a long name does not produce a wall of repeats.
    expect(unrenderable("आआआआ")).toEqual(["आ"]);
  });

  it("is exactly the set the PDF writer would keep, for any input", () => {
    // The guard must not be looser than the renderer, or a "?" still reaches an invoice.
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const kept = Array.from(raw)
          .map((ch) => {
            const code = ch.codePointAt(0) ?? 0;
            return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)
              ? ch
              : "?";
          })
          .join("");
        expect(isInvoiceable(raw)).toBe(kept === raw);
      }),
    );
  });
});

describe("invoice-printed fields refuse what the invoice cannot print (R-25)", () => {
  const base = {
    email: "owner@example.test",
    password: "CorrectHorse42battery",
    businessName: "Sharma & Associates",
    billingAddress: {
      line1: "12 MG Road",
      city: "Pune",
      country: "IN",
      postalCode: "411001",
      stateCode: "27",
    },
    acceptTerms: true,
    acceptPrivacy: true,
  };

  it("refuses a business name the tax invoice would print as '?'", () => {
    const bad = signupRequestSchema.safeParse({
      ...base,
      businessName: "आनंद ट्रेडिंग",
    });
    expect(bad.success).toBe(false);
    // The message must name the characters, so the person can act on it.
    expect(bad.error?.issues[0]?.message).toContain("आ");
  });

  it("refuses unprintable address lines and city too — all three print", () => {
    for (const field of ["line1", "city"] as const) {
      expect(
        signupRequestSchema.safeParse({
          ...base,
          billingAddress: { ...base.billingAddress, [field]: "海外" },
        }).success,
        field,
      ).toBe(false);
    }
  });

  it("still accepts the Latin-1 an Indian business actually uses", () => {
    expect(
      signupRequestSchema.safeParse({ ...base, businessName: "Café Ledger Pvt Ltd" })
        .success,
    ).toBe(true);
  });
});
