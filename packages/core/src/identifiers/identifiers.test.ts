import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  isValidAadhaar,
  isValidVerhoeff,
  synthesiseAadhaarForFixtures,
  verhoeffCheckDigit,
} from "./aadhaar.js";
import { couldBeAccountNumber, couldBeUan, ifscBankCode, isValidIfsc } from "./bank.js";
import {
  gstinCheckCharacter,
  gstinPan,
  gstinStateCode,
  hasGstinShape,
  isValidGstin,
  normaliseGstin,
} from "./gstin.js";
import { isValidPan, panHolderType } from "./pan.js";

/**
 * Specimen GSTINs, not customer data.
 *
 * Both carry check characters that this implementation independently reproduces. Two
 * agreeing specimens is a 1-in-1296 coincidence if the algorithm were wrong, which
 * together with the generated-check-character property below is the evidence that it
 * is right.
 *
 * TODO(review): confirm the mod-36 check-character algorithm against official GSTN
 * documentation before Phase 2, where tax invoices depend on it (SPEC §0.4 forbids
 * relying on an unverified external fact). Tracked as R-20 in docs/REVIEW_ITEMS.md.
 * A third specimen was dropped from this list because its check character could not be
 * reproduced and could not be sourced -- it was more likely misremembered than evidence
 * against two independent confirmations, but it is not evidence *for* anything either.
 */
const VALID_GSTINS = ["27AAPFU0939F1ZV", "29AAGCB7383J1Z4"] as const;

describe("GSTIN", () => {
  it("accepts known-valid GSTINs", () => {
    for (const g of VALID_GSTINS) {
      expect(isValidGstin(g), g).toBe(true);
    }
  });

  it("computes the check character that those GSTINs actually carry", () => {
    for (const g of VALID_GSTINS) {
      expect(gstinCheckCharacter(g.slice(0, 14)), g).toBe(g[14]);
    }
  });

  it("rejects a wrong check character — this is what shape-only validation misses", () => {
    for (const g of VALID_GSTINS) {
      const wrong = g[14] === "A" ? "B" : "A";
      const tampered = `${g.slice(0, 14)}${wrong}`;
      expect(hasGstinShape(tampered), `${tampered} should still look like a GSTIN`).toBe(
        true,
      );
      expect(isValidGstin(tampered), tampered).toBe(false);
    }
  });

  it("rejects a single-character substitution anywhere in the payload", () => {
    const g = VALID_GSTINS[0];
    let caught = 0;
    let attempted = 0;
    for (let i = 0; i < 14; i++) {
      const original = g[i] ?? "";
      for (const replacement of "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
        if (replacement === original) continue;
        const tampered = `${g.slice(0, i)}${replacement}${g.slice(i + 1)}`;
        if (!hasGstinShape(tampered)) continue; // shape already rejects it
        attempted++;
        if (!isValidGstin(tampered)) caught++;
      }
    }
    expect(attempted).toBeGreaterThan(50);
    // The mod-36 check catches the overwhelming majority; 1-in-36 collide by design.
    expect(caught / attempted).toBeGreaterThan(0.9);
  });

  it("rejects malformed shapes outright", () => {
    for (const bad of [
      "",
      "27AAPFU0939F1Z", // 14 chars
      "27AAPFU0939F1ZVX", // 16 chars
      "AA27APFU0939F1ZV", // state code not numeric
      "27AAPFU0939F1YV", // 14th char is not Z
      "27aapfu0939f1zv", // lower case, un-normalised
    ]) {
      expect(isValidGstin(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("extracts the state code for GST place of supply (SPEC §13)", () => {
    expect(gstinStateCode("27AAPFU0939F1ZV")).toBe("27"); // Maharashtra
    expect(gstinStateCode("29AAGCB7383J1Z4")).toBe("29"); // Karnataka
    // An invalid checksum yields no state rather than a plausible-looking one -- putting
    // the wrong place of supply on a tax invoice is the failure this prevents.
    expect(gstinStateCode("27AAPFU0939F1ZA")).toBeNull();
  });

  it("extracts the embedded PAN, which is why SPEC §17 always tokenises a GSTIN", () => {
    expect(gstinPan("27AAPFU0939F1ZV")).toBe("AAPFU0939F");
    expect(isValidPan("AAPFU0939F")).toBe(true);
    expect(gstinPan("27AAPFU0939F1ZA")).toBeNull();
  });

  it("normalises pasted input without accepting a malformed value", () => {
    expect(normaliseGstin(" 27aapfu0939f1zv ")).toBe("27AAPFU0939F1ZV");
    expect(isValidGstin(normaliseGstin("27 AAPFU 0939 F1ZV"))).toBe(true);
    expect(isValidGstin(normaliseGstin("27AAPFU0939F1ZA"))).toBe(false);
  });

  it("property: a generated check character always validates", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 37 }),
        fc.stringMatching(/^[A-Z]{5}$/u),
        fc.integer({ min: 0, max: 9999 }),
        fc.stringMatching(/^[A-Z]$/u),
        fc.stringMatching(/^[0-9A-Z]$/u),
        (state, panAlpha, panNum, panLast, entity) => {
          const prefix =
            String(state).padStart(2, "0") +
            panAlpha +
            String(panNum).padStart(4, "0") +
            panLast +
            entity +
            "Z";
          const full = `${prefix}${gstinCheckCharacter(prefix)}`;
          return hasGstinShape(full) && isValidGstin(full);
        },
      ),
    );
  });

  it("rejects a 14-character payload of the wrong length", () => {
    expect(() => gstinCheckCharacter("TOOSHORT")).toThrow(RangeError);
  });
});

describe("PAN", () => {
  it("accepts valid PANs and reads the holder type", () => {
    expect(isValidPan("AAPFU0939F")).toBe(true);
    expect(panHolderType("AAPFU0939F")).toBe("Firm / LLP");
    expect(panHolderType("AAACG2115R")).toBe("Company");
    expect(panHolderType("ABCPD1234E")).toBe("Individual");
  });

  it("rejects a bad shape or an unrecognised holder type", () => {
    for (const bad of ["AAPFU0939", "AAPF10939F", "aapfu0939f", "AAPFU0939FF", ""]) {
      expect(isValidPan(bad), bad).toBe(false);
    }
    // 'X' is not an issued holder-type character.
    expect(isValidPan("AAPXU0939F")).toBe(false);
  });
});

describe("Aadhaar (Verhoeff)", () => {
  it("validates a correctly checksummed number", () => {
    const generated = synthesiseAadhaarForFixtures("23456789012");
    expect(generated).toHaveLength(12);
    expect(isValidAadhaar(generated)).toBe(true);
  });

  it("rejects numbers starting 0 or 1, which UIDAI does not issue", () => {
    // Build a Verhoeff-valid string that starts with 1, to prove the rule is separate.
    const payload = "1234567890";
    const withCheck = `${payload}${String(verhoeffCheckDigit(payload))}`.padStart(
      12,
      "1",
    );
    expect(isValidAadhaar(withCheck)).toBe(false);
  });

  it("catches every single-digit error", () => {
    const valid = synthesiseAadhaarForFixtures("23456789012");
    for (let i = 0; i < 12; i++) {
      for (let d = 0; d <= 9; d++) {
        const replacement = String(d);
        if (replacement === valid[i]) continue;
        const tampered = `${valid.slice(0, i)}${replacement}${valid.slice(i + 1)}`;
        if (tampered[0] === "0" || tampered[0] === "1") continue; // rejected for another reason
        expect(isValidVerhoeff(tampered), tampered).toBe(false);
      }
    }
  });

  it("catches every adjacent transposition", () => {
    const valid = synthesiseAadhaarForFixtures("23456789012");
    for (let i = 0; i < 11; i++) {
      const a = valid[i] ?? "";
      const b = valid[i + 1] ?? "";
      if (a === b) continue;
      const tampered = `${valid.slice(0, i)}${b}${a}${valid.slice(i + 2)}`;
      expect(isValidVerhoeff(tampered), tampered).toBe(false);
    }
  });

  it("tolerates spaces and hyphens in presentation", () => {
    const valid = synthesiseAadhaarForFixtures("23456789012");
    const spaced = `${valid.slice(0, 4)} ${valid.slice(4, 8)} ${valid.slice(8)}`;
    expect(isValidAadhaar(spaced)).toBe(true);
  });

  it("rejects wrong lengths and non-digits", () => {
    for (const bad of ["2345678901", "2345678901234", "23456789012A", ""]) {
      expect(isValidAadhaar(bad), bad).toBe(false);
    }
  });

  it("property: a generated check digit always validates", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[2-9]\d{10}$/u), (eleven) => {
        return isValidAadhaar(synthesiseAadhaarForFixtures(eleven));
      }),
    );
  });

  it("property: most random 12-digit runs are NOT valid Aadhaar", () => {
    // This is the property that makes the detector usable: invoice numbers and account
    // numbers in a ledger must not be mistaken for Aadhaar.
    let valid = 0;
    const samples = 2000;
    for (let i = 0; i < samples; i++) {
      const n =
        String(2 + (i % 8)) +
        String(i * 7919)
          .padStart(11, "0")
          .slice(0, 11);
      if (isValidAadhaar(n)) valid++;
    }
    expect(valid / samples).toBeLessThan(0.2); // ~1/10 by chance
  });
});

describe("bank identifiers", () => {
  it("validates IFSC, requiring the literal zero in position 5", () => {
    expect(isValidIfsc("HDFC0001234")).toBe(true);
    expect(isValidIfsc("SBIN0000456")).toBe(true);
    expect(ifscBankCode("HDFC0001234")).toBe("HDFC");
    expect(isValidIfsc("HDFC1001234")).toBe(false); // 5th char must be 0
    expect(isValidIfsc("HDF00001234")).toBe(false); // needs 4 letters
    expect(isValidIfsc("hdfc0001234")).toBe(false); // un-normalised
  });

  it("treats account numbers as shape-only, needing column context", () => {
    expect(couldBeAccountNumber("123456789")).toBe(true);
    expect(couldBeAccountNumber("123456789012345678")).toBe(true);
    expect(couldBeAccountNumber("12345678")).toBe(false); // 8 digits, too short
    expect(couldBeAccountNumber("1234567890123456789")).toBe(false); // 19, too long
    // Deliberately true: an invoice number of this length is indistinguishable, which
    // is exactly why redaction pairs this with a header heuristic.
    expect(couldBeAccountNumber("202503150001")).toBe(true);
  });

  it("treats UAN as 12 digits, also needing column context", () => {
    expect(couldBeUan("100123456789")).toBe(true);
    expect(couldBeUan("10012345678")).toBe(false);
  });
});
