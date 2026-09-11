/**
 * AI cost in micro-USD, and its conversion to INR.
 *
 * SPEC §4: AI cost is stored as integer micro-USD *plus* the INR equivalent at the FX
 * rate in effect. Both are persisted on every `ai_calls` row (SPEC §9) -- the USD figure
 * is what Anthropic actually billed, the INR figure is what the margin dashboard reports,
 * and keeping both means a later rate change never silently restates history.
 *
 * SPEC §13: the rate is admin-set and carries a buffer (config, default 3%) so a rate
 * move between the call and the reporting period does not eat the margin.
 */

import {
  MICRO_USD_PER_USD,
  microUsd,
  paise,
  type MicroUsd,
  type Paise,
} from "./brand.js";
import { multiplyByDecimal, parseDecimal, type Decimal } from "./decimal.js";
import { divideRounded, type RoundingMode } from "./rounding.js";

/** The FX rate actually applied to a conversion, recorded alongside the result. */
export interface FxRate {
  /** Rupees per USD before the buffer, e.g. `"83.25"`. */
  readonly inrPerUsd: Decimal;
  /** Buffer percentage applied on top, e.g. `"3"` for 3%. */
  readonly bufferPercent: Decimal;
}

export function fxRate(inrPerUsd: string, bufferPercent: string): FxRate {
  const rate = parseDecimal(inrPerUsd);
  if (rate.unscaled <= 0n) {
    throw new RangeError(`fxRate: inrPerUsd must be positive, got ${inrPerUsd}`);
  }
  const buffer = parseDecimal(bufferPercent);
  if (buffer.unscaled < 0n) {
    throw new RangeError(
      `fxRate: bufferPercent must not be negative, got ${bufferPercent}`,
    );
  }
  return { inrPerUsd: rate, bufferPercent: buffer };
}

/** The effective rate including buffer, as an exact decimal: `inrPerUsd × (1 + buffer/100)`. */
export function effectiveInrPerUsd(rate: FxRate): Decimal {
  // inrPerUsd × (100 + buffer) / 100, kept exact by adding two scales rather than dividing.
  const bufferScale = 10n ** BigInt(rate.bufferPercent.scale);
  const multiplier = 100n * bufferScale + rate.bufferPercent.unscaled;
  return {
    unscaled: rate.inrPerUsd.unscaled * multiplier,
    scale: rate.inrPerUsd.scale + rate.bufferPercent.scale + 2,
  };
}

/**
 * Convert AI cost in micro-USD to paise at the given rate.
 *
 * Rounds up by default at the call site's discretion -- the margin guardrail is
 * protected by never *understating* cost, so `"ceil"` is the sensible mode for
 * anything feeding `max_ai_cost_ratio` (SPEC §2.6).
 */
export function microUsdToPaise(
  cost: MicroUsd,
  rate: FxRate,
  mode: RoundingMode = "ceil",
): Paise {
  const effective = effectiveInrPerUsd(rate);
  // cost (micro-USD) × rate (INR/USD) → INR, then ×100 → paise.
  // Divide by MICRO_USD_PER_USD last so no precision is lost on the way.
  const numerator = cost * effective.unscaled * 100n;
  const denominator = MICRO_USD_PER_USD * 10n ** BigInt(effective.scale);
  return paise(divideRounded(numerator, denominator, mode));
}

/** Parse a USD amount given as a decimal string into micro-USD. */
export function usdStringToMicroUsd(input: string): MicroUsd {
  const d = parseDecimal(input);
  if (d.scale > 6) {
    throw new RangeError(
      `usdStringToMicroUsd: ${JSON.stringify(input)} has ${String(d.scale)} decimal places; micro-USD holds at most 6`,
    );
  }
  return microUsd(d.unscaled * 10n ** BigInt(6 - d.scale));
}

/**
 * Token cost from a per-million-token price.
 *
 * `model_registry` stores prices as integer micro-USD per million tokens (SPEC §9), so
 * this is an exact integer operation: `tokens × pricePerMTok / 1_000_000`.
 */
export function tokenCostMicroUsd(
  tokens: bigint,
  pricePerMTokMicroUsd: bigint,
  mode: RoundingMode = "ceil",
): MicroUsd {
  if (tokens < 0n) throw new RangeError("tokenCostMicroUsd: tokens must not be negative");
  return microUsd(divideRounded(tokens * pricePerMTokMicroUsd, 1_000_000n, mode));
}

/** Apply a multiplier such as a cache-read discount or the batch discount (SPEC §14). */
export function applyCostMultiplier(
  cost: MicroUsd,
  multiplier: Decimal,
  mode: RoundingMode = "ceil",
): MicroUsd {
  return microUsd(multiplyByDecimal(cost, multiplier, mode));
}

export const addMicroUsd = (a: MicroUsd, b: MicroUsd): MicroUsd => microUsd(a + b);
export const sumMicroUsd = (values: readonly MicroUsd[]): MicroUsd =>
  microUsd(values.reduce<bigint>((acc, v) => acc + v, 0n));
