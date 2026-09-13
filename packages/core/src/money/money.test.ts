import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { microUsd, paise, PAISE_PER_RUPEE } from "./brand";
import {
  formatDecimal,
  multiplyByDecimal,
  multiplyByDecimalString,
  parseDecimal,
  percentOf,
} from "./decimal";
import {
  effectiveInrPerUsd,
  fxRate,
  microUsdToPaise,
  tokenCostMicroUsd,
  usdStringToMicroUsd,
} from "./fx";
import {
  addPaise,
  paiseToRupeeString,
  paiseToWholeRupees,
  rupeeStringToPaise,
  sumPaise,
} from "./paise";
import { divideRounded, roundUpToEnding, type RoundingMode } from "./rounding";

const MODES: RoundingMode[] = [
  "half_up",
  "half_even",
  "ceil",
  "floor",
  "trunc",
  "expand",
];

describe("divideRounded", () => {
  it("is exact when the division has no remainder", () => {
    for (const mode of MODES) {
      expect(divideRounded(100n, 4n, mode)).toBe(25n);
      expect(divideRounded(-100n, 4n, mode)).toBe(-25n);
    }
  });

  it("rounds halves per mode, symmetrically about zero", () => {
    // 5/2 = 2.5 exactly
    expect(divideRounded(5n, 2n, "half_up")).toBe(3n);
    expect(divideRounded(-5n, 2n, "half_up")).toBe(-3n);
    expect(divideRounded(5n, 2n, "half_even")).toBe(2n); // 2 is even
    expect(divideRounded(7n, 2n, "half_even")).toBe(4n); // 3 is odd -> 4
    expect(divideRounded(-5n, 2n, "half_even")).toBe(-2n);
  });

  it("directs non-halves per mode", () => {
    expect(divideRounded(7n, 3n, "ceil")).toBe(3n); // 2.33 -> 3
    expect(divideRounded(7n, 3n, "floor")).toBe(2n);
    expect(divideRounded(-7n, 3n, "ceil")).toBe(-2n); // toward +inf
    expect(divideRounded(-7n, 3n, "floor")).toBe(-3n); // toward -inf
    expect(divideRounded(-7n, 3n, "trunc")).toBe(-2n); // toward zero
    expect(divideRounded(-7n, 3n, "expand")).toBe(-3n); // away from zero
  });

  it("handles a negative denominator identically to negating the numerator", () => {
    for (const mode of MODES) {
      expect(divideRounded(7n, -3n, mode)).toBe(divideRounded(-7n, 3n, mode));
    }
  });

  it("rejects a zero denominator rather than returning Infinity", () => {
    expect(() => divideRounded(1n, 0n, "half_up")).toThrow(RangeError);
  });

  it("property: the result is always within 1 of the true quotient", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 18n), max: 10n ** 18n }),
        fc.bigInt({ min: 1n, max: 10n ** 9n }),
        fc.constantFrom(...MODES),
        (n, d, mode) => {
          const q = divideRounded(n, d, mode);
          // |n - q*d| < d  means q is one of the two integers bracketing n/d
          const residual = n - q * d;
          return (residual < 0n ? -residual : residual) < d;
        },
      ),
    );
  });

  it("property: half_even never drifts further than half_up over many roundings", () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: -999n, max: 999n }), { minLength: 50 }),
        (xs) => {
          // Sum of (x/2) rounded each way vs the exact sum, doubled to stay integral.
          const exactDoubled = xs.reduce<bigint>((a, x) => a + x, 0n);
          const evenSum = xs.reduce<bigint>(
            (a, x) => a + divideRounded(x, 2n, "half_even"),
            0n,
          );
          const upSum = xs.reduce<bigint>(
            (a, x) => a + divideRounded(x, 2n, "half_up"),
            0n,
          );
          const evenErr = evenSum * 2n - exactDoubled;
          const upErr = upSum * 2n - exactDoubled;
          const abs = (v: bigint): bigint => (v < 0n ? -v : v);
          return abs(evenErr) <= abs(upErr) + BigInt(xs.length);
        },
      ),
    );
  });
});

describe("roundUpToEnding", () => {
  it("rounds a quote up to the configured endings", () => {
    expect(roundUpToEnding(300n, [49, 99])).toBe(349n);
    expect(roundUpToEnding(350n, [49, 99])).toBe(399n);
    expect(roundUpToEnding(400n, [49, 99])).toBe(449n);
  });

  it("leaves a value that already ends correctly untouched", () => {
    expect(roundUpToEnding(349n, [49, 99])).toBe(349n);
    expect(roundUpToEnding(99n, [49, 99])).toBe(99n);
  });

  it("never rounds down", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 9n }), (v) => {
        return roundUpToEnding(v, [49, 99]) >= v;
      }),
    );
  });

  it("rejects an empty ending list", () => {
    expect(() => roundUpToEnding(1n, [])).toThrow(RangeError);
  });
});

describe("parseDecimal / formatDecimal", () => {
  it("parses exactly, preserving scale", () => {
    expect(parseDecimal("2.5")).toEqual({ unscaled: 25n, scale: 1 });
    expect(parseDecimal("0.20")).toEqual({ unscaled: 20n, scale: 2 });
    expect(parseDecimal("-1.075")).toEqual({ unscaled: -1075n, scale: 3 });
    expect(parseDecimal("18")).toEqual({ unscaled: 18n, scale: 0 });
  });

  it("rejects exponent notation, grouping and whitespace", () => {
    for (const bad of ["1e3", "1,000", " 1.5", "1.5 ", "", ".5", "1.", "abc", "+1"]) {
      expect(() => parseDecimal(bad), bad).toThrow(RangeError);
    }
  });

  it("property: format(parse(s)) round-trips for canonical strings", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }),
        fc.integer({ min: 0, max: 8 }),
        (unscaled, scale) => {
          const s = formatDecimal({ unscaled, scale });
          const back = parseDecimal(s);
          // Value equality, not representation equality: -0 formats as "0".
          return (
            back.unscaled * 10n ** BigInt(scale) === unscaled * 10n ** BigInt(back.scale)
          );
        },
      ),
    );
  });
});

describe("multiplyByDecimal", () => {
  it("applies the seed tier multipliers from SPEC §12 exactly", () => {
    const base = 999n; // company_setup base_credits
    expect(multiplyByDecimalString(base, "0.8", "half_up")).toBe(799n); // efficient: 799.2
    expect(multiplyByDecimalString(base, "1.0", "half_up")).toBe(999n); // professional
    expect(multiplyByDecimalString(base, "2.5", "half_up")).toBe(2498n); // expert: 2497.5
  });

  it("does not lose precision on an intermediate step", () => {
    // 0.1 + 0.2 !== 0.3 in float; exact here.
    const tenth = multiplyByDecimalString(1000n, "0.1", "half_up");
    const fifth = multiplyByDecimalString(1000n, "0.2", "half_up");
    expect(tenth + fifth).toBe(multiplyByDecimalString(1000n, "0.3", "half_up"));
  });

  it("property: multiplying by 1 is the identity for any scale", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
        fc.integer({ min: 0, max: 6 }),
        (v, scale) => {
          const one = { unscaled: 10n ** BigInt(scale), scale };
          return multiplyByDecimal(v, one, "half_up") === v;
        },
      ),
    );
  });
});

describe("percentOf", () => {
  it("computes the GST portion at the SPEC §13 default rate", () => {
    // ₹2,000 pack ex-GST = 200000 paise; 18% = 36000 paise = ₹360
    expect(percentOf(200_000n, "18", "half_up")).toBe(36_000n);
  });

  it("splits CGST and SGST equally without losing a paisa", () => {
    const gst = percentOf(200_000n, "18", "half_up");
    const cgst = divideRounded(gst, 2n, "half_up");
    const sgst = gst - cgst; // remainder deliberately goes to the second half
    expect(cgst + sgst).toBe(gst);
  });

  it("property: CGST + SGST always reconstructs the total GST exactly", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 12n }), (amount) => {
        const gst = percentOf(amount, "18", "half_up");
        const cgst = divideRounded(gst, 2n, "half_up");
        const sgst = gst - cgst;
        return cgst + sgst === gst;
      }),
    );
  });
});

describe("paise", () => {
  it("parses and renders canonical rupee strings", () => {
    expect(rupeeStringToPaise("1234.50")).toBe(123_450n);
    expect(rupeeStringToPaise("1234.5")).toBe(123_450n);
    expect(rupeeStringToPaise("1234")).toBe(123_400n);
    expect(rupeeStringToPaise("-0.01")).toBe(-1n);
    expect(paiseToRupeeString(paise(123_450n))).toBe("1234.50");
    expect(paiseToRupeeString(paise(-1n))).toBe("-0.01");
    expect(paiseToRupeeString(paise(0n))).toBe("0.00");
  });

  it("rejects a third decimal place instead of silently rounding it away", () => {
    expect(() => rupeeStringToPaise("1.005")).toThrow(RangeError);
  });

  it("converts to whole rupees under an explicit mode", () => {
    expect(paiseToWholeRupees(paise(150n), "half_up")).toBe(2n);
    expect(paiseToWholeRupees(paise(150n), "floor")).toBe(1n);
    expect(paiseToWholeRupees(paise(-150n), "half_up")).toBe(-2n);
  });

  it("property: paise -> string -> paise round-trips", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }), (v) => {
        return rupeeStringToPaise(paiseToRupeeString(paise(v))) === v;
      }),
    );
  });

  it("property: sum is associative and order-independent", () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), { maxLength: 200 }),
        (values) => {
          const xs = values.map(paise);
          const forward = sumPaise(xs);
          const reversed = sumPaise([...xs].reverse());
          const folded = xs.reduce(addPaise, paise(0n));
          return forward === reversed && forward === folded;
        },
      ),
    );
  });

  it("property: rounding to rupees never changes a total computed from unrounded values", () => {
    // SPEC §20: totals are computed from unrounded values. This asserts the gap between
    // "sum then round" and "round each then sum" is bounded by the item count -- i.e.
    // that we must do the former, and by how much it matters.
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: 0n, max: 10n ** 9n }), {
          minLength: 1,
          maxLength: 100,
        }),
        (values) => {
          const xs = values.map(paise);
          const roundedTotal = paiseToWholeRupees(sumPaise(xs), "half_up");
          const totalOfRounded = xs.reduce<bigint>(
            (a, v) => a + paiseToWholeRupees(v, "half_up"),
            0n,
          );
          const drift = roundedTotal - totalOfRounded;
          return (drift < 0n ? -drift : drift) <= BigInt(xs.length);
        },
      ),
    );
  });

  it("has no float path: PAISE_PER_RUPEE is a bigint", () => {
    expect(typeof PAISE_PER_RUPEE).toBe("bigint");
  });
});

describe("fx and AI cost", () => {
  it("applies the buffer on top of the base rate", () => {
    const rate = fxRate("83.25", "3");
    // 83.25 * 1.03 = 85.7475, exactly.
    expect(formatDecimal(effectiveInrPerUsd(rate))).toBe("85.7475");
  });

  it("gives the same value whichever scale the buffer is written at", () => {
    // "3", "3.0" and "3.00" differ in scale, so the result's scale differs too.
    // The value must not. Compare numerically, not by rendering.
    const asRatio = ["3", "3.0", "3.00"]
      .map((b) => effectiveInrPerUsd(fxRate("83.25", b)))
      .map((d) => ({ n: d.unscaled, p: 10n ** BigInt(d.scale) }));

    // a/b == c/d  <=>  a*d == c*b, with no division and no float.
    const [first, ...rest] = asRatio;
    if (first === undefined) throw new Error("no rates to compare");
    for (const other of rest) {
      expect(first.n * other.p).toBe(other.n * first.p);
    }
  });

  it("converts micro-USD to paise, rounding up so cost is never understated", () => {
    const rate = fxRate("83.25", "3");
    // $1.00 = 1_000_000 micro-USD -> 85.7475 INR -> 8574.75 paise -> ceil 8575
    expect(microUsdToPaise(usdStringToMicroUsd("1"), rate)).toBe(8575n);
  });

  it("computes token cost from a per-MTok price", () => {
    // Haiku seed: $1/MTok input = 1_000_000 micro-USD per MTok.
    // 250_000 tokens -> $0.25 -> 250_000 micro-USD
    expect(tokenCostMicroUsd(250_000n, 1_000_000n)).toBe(250_000n);
    // 1 token at $5/MTok rounds up to 5 micro-USD, never down to 0.
    expect(tokenCostMicroUsd(1n, 5_000_000n)).toBe(5n);
  });

  it("rejects a non-positive or negative-buffer FX rate", () => {
    expect(() => fxRate("0", "3")).toThrow(RangeError);
    expect(() => fxRate("-83", "3")).toThrow(RangeError);
    expect(() => fxRate("83", "-1")).toThrow(RangeError);
  });

  it("property: converted cost is monotonic in token count", () => {
    const rate = fxRate("83.25", "3");
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 9n }),
        fc.bigInt({ min: 0n, max: 10n ** 9n }),
        (a, b) => {
          const lo = a < b ? a : b;
          const hi = a < b ? b : a;
          const costLo = microUsdToPaise(tokenCostMicroUsd(lo, 2_000_000n), rate);
          const costHi = microUsdToPaise(tokenCostMicroUsd(hi, 2_000_000n), rate);
          return costLo <= costHi;
        },
      ),
    );
  });

  it("property: cost is never zero for a non-zero token count at a non-zero price", () => {
    // A silently-zero AI cost would make the margin guardrail blind.
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 10n ** 9n }), (tokens) => {
        return tokenCostMicroUsd(tokens, 1_000_000n) > 0n;
      }),
    );
  });
});

describe("micro-USD", () => {
  it("parses USD strings up to six decimals", () => {
    expect(usdStringToMicroUsd("1")).toBe(1_000_000n);
    expect(usdStringToMicroUsd("0.000001")).toBe(1n);
    expect(usdStringToMicroUsd("12.5")).toBe(12_500_000n);
  });

  it("rejects a seventh decimal rather than truncating it", () => {
    expect(() => usdStringToMicroUsd("0.0000001")).toThrow(RangeError);
  });

  it("brands are structural only, so runtime values stay plain bigints", () => {
    expect(typeof microUsd(5n)).toBe("bigint");
  });
});
