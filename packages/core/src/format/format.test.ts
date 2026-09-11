import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { paise } from "../money/brand.js";
import {
  formatPaise,
  formatPaiseCompact,
  formatPercent,
  groupIndian,
  groupWestern,
  type NumberFormatOptions,
} from "./indian-number.js";

const LAKHS: NumberFormatOptions = { style: "lakhs_crores", decimals: 2 };

describe("Indian digit grouping (SPEC §2.14)", () => {
  it("groups by three then twos, not threes", () => {
    expect(groupIndian("100000")).toBe("1,00,000");
    expect(groupIndian("1234567")).toBe("12,34,567");
    expect(groupIndian("12345678")).toBe("1,23,45,678");
    expect(groupIndian("1000")).toBe("1,000");
    expect(groupIndian("999")).toBe("999");
    expect(groupIndian("1")).toBe("1");
  });

  it("differs from western grouping above a lakh — the whole point", () => {
    expect(groupIndian("100000")).toBe("1,00,000");
    expect(groupWestern("100000")).toBe("100,000");
    expect(groupIndian("1000")).toBe(groupWestern("1000")); // identical below 10,000
  });

  it("property: grouping preserves every digit in order", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[1-9]\d{0,17}$/u), (digits) => {
        return groupIndian(digits).replace(/,/gu, "") === digits;
      }),
    );
  });
});

describe("formatPaise", () => {
  it("formats rupees with Indian grouping", () => {
    expect(formatPaise(paise(10_000_000n), LAKHS)).toBe("1,00,000.00");
    expect(formatPaise(paise(123_456_789n), LAKHS)).toBe("12,34,567.89");
    expect(formatPaise(paise(0n), LAKHS)).toBe("0.00");
  });

  it("honours the absolute style with western grouping", () => {
    expect(formatPaise(paise(10_000_000n), { style: "absolute", decimals: 2 })).toBe(
      "100,000.00",
    );
  });

  it("honours the millions style", () => {
    // ₹1,00,00,000 = 10 million
    expect(formatPaise(paise(1_000_000_000n), { style: "millions", decimals: 2 })).toBe("10.00");
  });

  it("honours the decimals setting", () => {
    expect(formatPaise(paise(123_456_789n), { style: "lakhs_crores", decimals: 0 })).toBe(
      "12,34,568",
    );
    expect(formatPaise(paise(123_456_789n), { style: "lakhs_crores", decimals: 1 })).toBe(
      "12,34,567.9",
    );
  });

  it("shows negatives in brackets when configured (SPEC §32)", () => {
    expect(formatPaise(paise(-123_456n), LAKHS)).toBe("-1,234.56");
    expect(formatPaise(paise(-123_456n), { ...LAKHS, negativesInBrackets: true })).toBe(
      "(1,234.56)",
    );
  });

  it("rejects an out-of-range decimals setting", () => {
    expect(() => formatPaise(paise(1n), { style: "absolute", decimals: 7 })).toThrow(RangeError);
    expect(() => formatPaise(paise(1n), { style: "absolute", decimals: -1 })).toThrow(RangeError);
  });

  it("never loses a digit of magnitude, even at crore scale", () => {
    // ₹1,23,45,67,890.12
    expect(formatPaise(paise(123_456_789_012n), LAKHS)).toBe("1,23,45,67,890.12");
  });

  it("property: stripping separators recovers the exact scaled integer", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 15n }), (v) => {
        const text = formatPaise(paise(v), LAKHS);
        const digits = text.replace(/[,.]/gu, "");
        return BigInt(digits) === v;
      }),
    );
  });
});

describe("formatPaiseCompact", () => {
  it("uses lakh and crore units", () => {
    expect(formatPaiseCompact(paise(12_500_000_00n))).toBe("1.25 Cr");
    expect(formatPaiseCompact(paise(34_000_000n))).toBe("3.40 L");
    expect(formatPaiseCompact(paise(99_900n))).toBe("999.00");
  });

  it("keeps the sign", () => {
    expect(formatPaiseCompact(paise(-12_500_000_00n))).toBe("-1.25 Cr");
  });
});

describe("formatPercent", () => {
  it("formats a ratio as a percentage", () => {
    // 0.1825 -> 18.3%
    expect(formatPercent({ unscaled: 1825n, scale: 4 })).toBe("18.3%");
    expect(formatPercent({ unscaled: 1825n, scale: 4 }, 2)).toBe("18.25%");
    expect(formatPercent({ unscaled: -55n, scale: 3 }, 1)).toBe("-5.5%");
  });

  it("returns null for null, never 0% (SPEC §20)", () => {
    // Division by zero produces an explicit null with a reason code. Rendering that
    // as "0.0%" would tell a reader the margin was zero when it is unknown.
    expect(formatPercent(null)).toBeNull();
  });
});
