/**
 * Exact decimal ratios applied to integer money.
 *
 * Several spec rules multiply an integer amount by a fraction:
 *   - tier multipliers, 0.8 / 1.0 / 2.5 (SPEC §12)
 *   - `max_ai_cost_ratio`, default 0.20 (SPEC §2.6)
 *   - the GST rate, default 18% (SPEC §13)
 *   - the FX buffer, default 3% (SPEC §13)
 *
 * All of them arrive from config as decimal strings. Parsing them to a float first
 * would put 0.1 + 0.2 into the pricing engine, so they are parsed into an exact
 * scaled integer and applied with bigint arithmetic and a named rounding mode.
 */

import { divideRounded, type RoundingMode } from "./rounding";

/** An exact decimal held as `unscaled / 10^scale`. `2.5` is `{ unscaled: 25n, scale: 1 }`. */
export interface Decimal {
  readonly unscaled: bigint;
  readonly scale: number;
}

const DECIMAL_PATTERN = /^(-)?(\d+)(?:\.(\d+))?$/u;

/**
 * Parse a decimal string exactly. Accepts `"2"`, `"2.5"`, `"0.20"`, `"-1.075"`.
 *
 * Rejects exponent notation, grouping separators and whitespace: config values that
 * reach here should already be canonical, and quietly accepting `"1e3"` or `"1,000"`
 * would hide a malformed config rather than surface it.
 */
export function parseDecimal(input: string): Decimal {
  const match = DECIMAL_PATTERN.exec(input);
  if (!match) {
    throw new RangeError(`parseDecimal: ${JSON.stringify(input)} is not a plain decimal`);
  }
  const [, sign, whole = "", fraction = ""] = match;
  const unscaled = BigInt(`${sign ?? ""}${whole}${fraction}`);
  return { unscaled, scale: fraction.length };
}

/** Render a Decimal back to its canonical string. Round-trips with `parseDecimal`. */
export function formatDecimal(d: Decimal): string {
  const negative = d.unscaled < 0n;
  const digits = (negative ? -d.unscaled : d.unscaled)
    .toString()
    .padStart(d.scale + 1, "0");
  const cut = digits.length - d.scale;
  const whole = digits.slice(0, cut);
  const fraction = digits.slice(cut);
  const sign = negative ? "-" : "";
  return d.scale === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}

/**
 * Multiply an integer amount by a decimal ratio, rounding once at the end.
 *
 * The multiply happens before the divide, so no intermediate precision is lost:
 * `value × unscaled / 10^scale`, evaluated exactly in bigint, then rounded.
 */
export function multiplyByDecimal(
  value: bigint,
  ratio: Decimal,
  mode: RoundingMode,
): bigint {
  return divideRounded(value * ratio.unscaled, 10n ** BigInt(ratio.scale), mode);
}

/** Convenience for a decimal supplied as a string, e.g. a config value. */
export function multiplyByDecimalString(
  value: bigint,
  ratio: string,
  mode: RoundingMode,
): bigint {
  return multiplyByDecimal(value, parseDecimal(ratio), mode);
}

/**
 * Apply a percentage, e.g. GST at `"18"` or an FX buffer at `"3"`.
 *
 * Returns only the tax or buffer portion, not the total, so the caller can show the
 * base and the addition as separate lines -- which SPEC §13 requires before payment.
 */
export function percentOf(value: bigint, percent: string, mode: RoundingMode): bigint {
  const p = parseDecimal(percent);
  return divideRounded(value * p.unscaled, 100n * 10n ** BigInt(p.scale), mode);
}
