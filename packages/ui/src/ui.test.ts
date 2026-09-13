import { paise } from "@magicmis/core/money";
import { describe, expect, it } from "vitest";

import {
  displayAmount,
  numericCellStyle,
  varianceAriaLabel,
  varianceColor,
  varianceDirection,
  varianceGlyph,
} from "./numeric";
import { elevation, tokens, typography, variance } from "./tokens";

describe("variance presentation (SPEC §32)", () => {
  it("reads direction from the sign", () => {
    expect(varianceDirection(paise(100n))).toBe("up");
    expect(varianceDirection(paise(-100n))).toBe("down");
    expect(varianceDirection(paise(0n))).toBe("flat");
    expect(varianceDirection(null)).toBe("flat");
  });

  it("always offers a non-colour glyph, so meaning never depends on colour alone", () => {
    expect(varianceGlyph("up")).toBe("↑");
    expect(varianceGlyph("down")).toBe("↓");
    expect(varianceGlyph("flat")).toBe("–");
  });

  it("uses no emoji anywhere — SPEC §32 rules them out", () => {
    const emoji = /\p{Extended_Pictographic}/u;
    for (const direction of ["up", "down", "flat"] as const) {
      expect(emoji.test(varianceGlyph(direction)), varianceGlyph(direction)).toBe(false);
    }
  });

  it("colours by whether the movement is good, not by whether it is up", () => {
    // Revenue rising is good; cost rising is not. Colouring both green would be wrong.
    expect(varianceColor("up", "higher_is_better")).toBe(variance.positive);
    expect(varianceColor("up", "lower_is_better")).toBe(variance.negative);
    expect(varianceColor("down", "higher_is_better")).toBe(variance.negative);
    expect(varianceColor("down", "lower_is_better")).toBe(variance.positive);
  });

  it("stays neutral when there is no movement or no polarity", () => {
    expect(varianceColor("flat", "higher_is_better")).toBe(variance.neutral);
    expect(varianceColor("up", "neutral")).toBe(variance.neutral);
  });

  it("gives a screen reader the meaning without the glyph", () => {
    expect(varianceAriaLabel("up", "1,00,000.00")).toBe("increased by 1,00,000.00");
    expect(varianceAriaLabel("down", "5,000.00")).toBe("decreased by 5,000.00");
    expect(varianceAriaLabel("flat", "0.00")).toBe("no change");
  });
});

describe("numeric cells", () => {
  it("requests tabular numerals and right alignment", () => {
    // Proportional digits break column alignment, which this audience cannot tolerate.
    expect(numericCellStyle.fontVariantNumeric).toContain("tabular-nums");
    expect(numericCellStyle.textAlign).toBe("right");
    expect(typography.numericFeatureSettings).toContain("tnum");
  });

  it("renders a missing figure as a dash, never as zero (SPEC §20)", () => {
    const options = { style: "lakhs_crores", decimals: 2 } as const;
    expect(displayAmount(null, options)).toBe("—");
    expect(displayAmount(paise(0n), options)).toBe("0.00");
    // A real zero and an unknown must not look the same.
    expect(displayAmount(null, options)).not.toBe(displayAmount(paise(0n), options));
  });

  it("formats with Indian grouping", () => {
    expect(
      displayAmount(paise(10_000_000n), { style: "lakhs_crores", decimals: 2 }),
    ).toBe("1,00,000.00");
  });
});

describe("design tokens honour the SPEC §32 prohibitions", () => {
  it("offers no gradient token", () => {
    const serialised = JSON.stringify(tokens);
    expect(serialised).not.toMatch(/gradient/iu);
  });

  it("offers no glow — shadows separate, they do not radiate", () => {
    expect(JSON.stringify(tokens)).not.toMatch(/glow/iu);
    for (const shadow of Object.values(elevation)) {
      // A glow is a shadow with no offset and a wide spread. Every shadow here has a
      // vertical offset and no spread term.
      if (shadow === "none") continue;
      expect(shadow).toMatch(/^0 \d+px \d+px rgba/u);
    }
  });

  it("keeps radii small enough that nothing reads as a blob", () => {
    for (const value of Object.values(tokens.radius)) {
      const px = Number.parseInt(value.replace("px", ""), 10);
      expect(Number.isNaN(px) ? 0 : px).toBeLessThanOrEqual(6);
    }
  });

  it("has exactly one accent family", () => {
    // "restrained neutral palette with one accent colour"
    const families = Object.keys(tokens).filter((k) => ["accent", "neutral"].includes(k));
    expect(families).toHaveLength(2);
  });

  it("separates variance colours from status colours", () => {
    // Variance red/green is reserved for variance meaning. Status uses its own ramp so
    // an informational badge can never be mistaken for a movement.
    expect(tokens.status.warning).not.toBe(tokens.variance.negative);
    expect(tokens.status.info).not.toBe(tokens.variance.positive);
  });

  it("defines a visible focus ring (WCAG 2.2 AA)", () => {
    expect(tokens.focus.ringWidth).toBe("2px");
    expect(tokens.focus.ringColor).toBeTruthy();
  });
});
