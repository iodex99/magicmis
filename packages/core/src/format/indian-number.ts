/**
 * Indian number formatting.
 *
 * SPEC §2.14: lakhs/crores grouping, with absolute and millions options.
 * SPEC §32: tabular numerals, right-aligned, negatives in brackets per config.
 *
 * Indian grouping puts the first separator after three digits and every **two**
 * thereafter: 1,00,000 not 100,000. `Intl.NumberFormat("en-IN")` does this correctly,
 * but it is not used here because it takes a `number` -- which would mean converting
 * integer paise to a float to display it, reintroducing exactly the precision loss the
 * money module exists to prevent. This formats from the integer directly.
 */

import { unbrand, type Paise } from "../money/brand.js";
import { formatDecimal } from "../money/decimal.js";
import { divideRounded, type RoundingMode } from "../money/rounding.js";

export type NumberFormatStyle = "lakhs_crores" | "absolute" | "millions";

export interface NumberFormatOptions {
  readonly style: NumberFormatStyle;
  /** Decimal places to display. `companies.decimals` in SPEC §9. */
  readonly decimals: number;
  /** Show negatives as `(1,234)` rather than `-1,234`. Accounting convention. */
  readonly negativesInBrackets?: boolean;
  /** Rounding applied at the display boundary only (SPEC §20). */
  readonly rounding?: RoundingMode;
}

export const LAKH = 100_000n;
export const CRORE = 10_000_000n;
export const MILLION = 1_000_000n;

/**
 * Apply Indian digit grouping to a string of digits.
 *
 * `"100000"` → `"1,00,000"`. Last three digits, then pairs.
 */
export function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/gu, ",");
  return `${grouped},${last3}`;
}

/** Western grouping, for the `millions` style. `"1000000"` → `"1,000,000"`. */
export function groupWestern(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}

interface Split {
  readonly negative: boolean;
  readonly whole: string;
  readonly fraction: string;
}

/** Split a scaled integer into sign, whole and fractional digit strings. */
function splitScaled(value: bigint, scale: number): Split {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const digits = abs.toString().padStart(scale + 1, "0");
  const cut = digits.length - scale;
  return { negative, whole: digits.slice(0, cut), fraction: digits.slice(cut) };
}

function assemble(split: Split, grouped: string, options: NumberFormatOptions): string {
  const body = split.fraction === "" ? grouped : `${grouped}.${split.fraction}`;
  if (!split.negative) return body;
  return options.negativesInBrackets === true ? `(${body})` : `-${body}`;
}

/**
 * Format paise for display.
 *
 * The `lakhs_crores` and `absolute` styles differ only in grouping -- both show the full
 * rupee amount. `millions` divides by a million and appends no suffix, matching how a
 * company that has chosen that style expects to read its own MIS.
 */
export function formatPaise(value: Paise, options: NumberFormatOptions): string {
  const { decimals, style, rounding = "half_up" } = options;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) {
    throw new RangeError(`formatPaise: decimals ${String(decimals)} out of range (0-6)`);
  }

  if (style === "millions") {
    // paise -> millions of rupees, at the requested precision.
    // value / (100 * 1e6) rendered with `decimals` places = value * 10^decimals / 1e8
    const scaled = divideRounded(
      value * 10n ** BigInt(decimals),
      100n * MILLION,
      rounding,
    );
    const split = splitScaled(scaled, decimals);
    return assemble(split, groupWestern(split.whole), options);
  }

  // paise -> rupees at `decimals` places: value * 10^decimals / 100
  const scaled = divideRounded(value * 10n ** BigInt(decimals), 100n, rounding);
  const split = splitScaled(scaled, decimals);
  const grouped =
    style === "lakhs_crores" ? groupIndian(split.whole) : groupWestern(split.whole);
  return assemble(split, grouped, options);
}

/**
 * Compact Indian notation: `1.25 Cr`, `3.40 L`.
 *
 * For KPI cards where the full figure would not fit. Every such display still links to
 * its lineage panel (SPEC §20), so the exact value is one click away.
 */
export function formatPaiseCompact(
  value: Paise,
  decimals = 2,
  rounding: RoundingMode = "half_up",
): string {
  const negative = value < 0n;
  const raw = unbrand(value);
  const absRupees = (negative ? -raw : raw) / 100n;

  let unit = "";
  let divisor = 1n;
  if (absRupees >= CRORE) {
    unit = " Cr";
    divisor = CRORE;
  } else if (absRupees >= LAKH) {
    unit = " L";
    divisor = LAKH;
  }

  const magnitude = negative ? -raw : raw;
  const scaled = divideRounded(
    magnitude * 10n ** BigInt(decimals),
    100n * divisor,
    rounding,
  );
  const split = splitScaled(scaled, decimals);

  const grouped = groupIndian(split.whole);
  const body = split.fraction === "" ? grouped : `${grouped}.${split.fraction}`;
  return `${negative ? "-" : ""}${body}${unit}`;
}

/**
 * Format a ratio as a percentage string.
 *
 * Margins and variances are ratios, not money, so they carry their own scale. Returns
 * `null` for a null input -- SPEC §20 requires division by zero and missing data to
 * produce an explicit null with a reason code, never 0, and the formatter must not
 * quietly turn that back into "0.0%".
 */
export function formatPercent(
  ratio: { unscaled: bigint; scale: number } | null,
  decimals = 1,
  rounding: RoundingMode = "half_up",
): string | null {
  if (ratio === null) return null;
  // ratio -> percent at `decimals` places: unscaled * 100 * 10^decimals / 10^scale
  const scaled = divideRounded(
    ratio.unscaled * 100n * 10n ** BigInt(decimals),
    10n ** BigInt(ratio.scale),
    rounding,
  );
  return `${formatDecimal({ unscaled: scaled, scale: decimals })}%`;
}
