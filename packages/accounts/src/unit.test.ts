import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  generateBackupCode,
  generateBackupCodes,
  hashBackupCode,
  isWellFormedBackupCode,
  normaliseBackupCode,
  verifyBackupCode,
} from "./backup-codes.js";
import { isDesktopUserAgent, isDeviceAgnosticPath } from "./desktop.js";
import {
  describeUserAgent,
  deviceFingerprintHash,
  normaliseUserAgent,
} from "./device.js";
import {
  placeOfSupplyState,
  signupProfileSchema,
  signupRequestSchema,
} from "./signup.js";
import { GST_STATE_CODES, isGstStateCode } from "./state-codes.js";

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

describe("backup codes (SPEC §8)", () => {
  it("formats codes as XXXX-XXXX from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateBackupCode();
      expect(code).toMatch(
        /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}$/u,
      );
      // No look-alikes, ever.
      expect(code).not.toMatch(/[01ILO]/u);
    }
  });

  it("issues distinct codes in one batch", () => {
    const codes = generateBackupCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
  });

  it("refuses an out-of-range count", () => {
    expect(() => generateBackupCodes(0)).toThrow(RangeError);
    expect(() => generateBackupCodes(51)).toThrow(RangeError);
  });

  it("normalises case, spaces and hyphens without folding look-alikes", () => {
    expect(normaliseBackupCode(" abcd-efgh ")).toBe("ABCDEFGH");
    expect(normaliseBackupCode("ab cd ef gh")).toBe("ABCDEFGH");
    // O and 0 are outside the alphabet; they must stay invalid rather than be rewritten.
    expect(isWellFormedBackupCode(normaliseBackupCode("ABCD-EFG0"))).toBe(false);
    expect(isWellFormedBackupCode(normaliseBackupCode("ABCD-EFGO"))).toBe(false);
  });

  it("verifies a code against its own hash and not against another's", async () => {
    const [a, b] = generateBackupCodes(2);
    if (a === undefined || b === undefined) throw new Error("need two codes");
    const hash = await hashBackupCode(a);
    expect(await verifyBackupCode(a, hash)).toBe(true);
    expect(await verifyBackupCode(a.toLowerCase().replace("-", " "), hash)).toBe(true);
    expect(await verifyBackupCode(b, hash)).toBe(false);
  });

  it("salts every hash, so equal codes do not produce equal hashes", async () => {
    const code = generateBackupCode();
    expect(await hashBackupCode(code)).not.toBe(await hashBackupCode(code));
  });

  it("records the scrypt parameters with the hash", async () => {
    expect(await hashBackupCode(generateBackupCode())).toMatch(
      /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/u,
    );
  });

  it("never matches a malformed stored hash", async () => {
    const code = generateBackupCode();
    for (const bad of [
      "",
      "plain",
      "scrypt$1$2$3",
      "bcrypt$x$y$z$a$b",
      "scrypt$0$8$1$AA==$AA==",
    ]) {
      expect(await verifyBackupCode(code, bad), bad).toBe(false);
    }
  });
});

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
      pincode: "411001",
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
    for (const pincode of ["011001", "41100", "4110011", "ABCDEF"]) {
      expect(
        signupRequestSchema.safeParse({
          ...base,
          billingAddress: { ...base.billingAddress, pincode },
        }).success,
        pincode,
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
