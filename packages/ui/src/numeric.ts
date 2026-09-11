/**
 * Numeric presentation helpers.
 *
 * These sit between the engine and the screen. They are deliberately dumb: they never
 * compute a figure, only present one that was computed deterministically (SPEC §2.7).
 */

import { formatPaise, type NumberFormatOptions } from "@magicmis/core/format";
import type { Paise } from "@magicmis/core/money";

import { typography, variance } from "./tokens.js";

/** The direction a variance points, independent of how it is coloured. */
export type VarianceDirection = "up" | "down" | "flat";

export function varianceDirection(value: Paise | null): VarianceDirection {
  if (value === null) return "flat";
  if (value > 0n) return "up";
  if (value < 0n) return "down";
  return "flat";
}

/**
 * The glyph that carries variance meaning without colour.
 *
 * SPEC §32: red/green is used only for variance and **always paired with a sign or
 * arrow**, so meaning never relies on colour alone. This is that pairing. It is a plain
 * arrow, not an emoji -- SPEC §32 rules emojis out everywhere.
 */
export function varianceGlyph(direction: VarianceDirection): string {
  switch (direction) {
    case "up":
      return "↑"; // ↑
    case "down":
      return "↓"; // ↓
    case "flat":
      return "–"; // –
  }
}

/**
 * Whether a movement is good or bad, which is not the same as whether it is up or down.
 *
 * Revenue up is good; cost up is not. The caller states the polarity rather than letting
 * the component guess, because guessing would colour a cost increase green.
 */
export type MetricPolarity = "higher_is_better" | "lower_is_better" | "neutral";

export function varianceColor(
  direction: VarianceDirection,
  polarity: MetricPolarity,
): string {
  if (direction === "flat" || polarity === "neutral") return variance.neutral;
  const good =
    polarity === "higher_is_better" ? direction === "up" : direction === "down";
  return good ? variance.positive : variance.negative;
}

/** Inline style for any cell holding a figure. Tabular numerals, right-aligned. */
export const numericCellStyle = {
  fontFeatureSettings: typography.numericFeatureSettings,
  fontVariantNumeric: "tabular-nums lining-nums",
  textAlign: "right",
} as const;

/**
 * Render an amount for display, or the em-dash placeholder when it is absent.
 *
 * SPEC §20 requires division by zero and missing data to produce an explicit null with a
 * reason code, never 0. Rendering null as "0.00" would tell a reader the figure is zero
 * when it is unknown, so null renders as a dash and the reason belongs in a tooltip.
 */
export function displayAmount(value: Paise | null, options: NumberFormatOptions): string {
  if (value === null) return "—"; // —
  return formatPaise(value, options);
}

/**
 * Accessible label for a variance figure.
 *
 * A screen reader gets "increased by X" rather than an arrow glyph, so the meaning
 * survives without either colour or shape (WCAG 2.2 AA, SPEC §32).
 */
export function varianceAriaLabel(
  direction: VarianceDirection,
  formattedValue: string,
): string {
  switch (direction) {
    case "up":
      return `increased by ${formattedValue}`;
    case "down":
      return `decreased by ${formattedValue}`;
    case "flat":
      return "no change";
  }
}
