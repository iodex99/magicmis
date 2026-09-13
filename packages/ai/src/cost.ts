/**
 * AI cost from usage (SPEC §4, §13, §14). Computed only from the usage object Anthropic
 * returns to the server — never from anything a browser reports (SPEC §7).
 *
 * Billing, verified 2026-09-13 (https://platform.claude.com/docs/en/about-claude/pricing and
 * /build-with-claude/prompt-caching): `input_tokens` is the uncached remainder; cache writes
 * bill at 1.25× (5 min) or 2× (1 h) base input; cache reads at the model's read multiplier;
 * output at the output price; the Batch API discount applies to all of it.
 *
 * Every component is summed as an exact rational and rounded up once, to the micro-USD, so
 * recorded cost is never understated (the margin guardrail depends on that).
 */

import {
  microUsd,
  microUsdToPaise,
  parseDecimal,
  fxRate,
  type MicroUsd,
  type Paise,
} from "@magicmis/core/money";
import { divideRounded } from "@magicmis/core/money";

import type { ModelRow } from "./registry";

export interface UsageLike {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_creation_input_tokens?: number | null;
  readonly cache_read_input_tokens?: number | null;
  readonly cache_creation?: {
    readonly ephemeral_5m_input_tokens: number;
    readonly ephemeral_1h_input_tokens: number;
  } | null;
}

/** An exact rational: numerator / 10^scale. */
interface Rational {
  n: bigint;
  scale: number;
}

const toScale = (r: Rational, scale: number): bigint =>
  r.n * 10n ** BigInt(scale - r.scale);

function term(tokens: number, pricePerMTok: bigint, multiplier: string): Rational {
  const m = parseDecimal(multiplier);
  return { n: BigInt(tokens) * pricePerMTok * m.unscaled, scale: m.scale };
}

export function costMicroUsd(
  usage: UsageLike,
  model: ModelRow,
  options: { batch?: boolean } = {},
): MicroUsd {
  for (const v of [
    usage.input_tokens,
    usage.output_tokens,
    usage.cache_creation_input_tokens ?? 0,
    usage.cache_read_input_tokens ?? 0,
  ]) {
    if (!Number.isInteger(v) || v < 0)
      throw new RangeError("usage token counts must be non-negative integers");
  }
  const created = usage.cache_creation_input_tokens ?? 0;
  const oneHour = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  // Without a breakdown every cache write is treated as 5-minute; with one, the remainder is.
  const fiveMin = usage.cache_creation
    ? usage.cache_creation.ephemeral_5m_input_tokens
    : created;
  if (usage.cache_creation && fiveMin + oneHour !== created) {
    throw new RangeError(
      "cache_creation breakdown does not sum to cache_creation_input_tokens",
    );
  }

  const terms: Rational[] = [
    term(usage.input_tokens, model.input_price_per_mtok_micro_usd, "1"),
    term(fiveMin, model.input_price_per_mtok_micro_usd, model.cache_write_multiplier),
    term(oneHour, model.input_price_per_mtok_micro_usd, model.cache_write_1h_multiplier),
    term(
      usage.cache_read_input_tokens ?? 0,
      model.input_price_per_mtok_micro_usd,
      model.cache_read_multiplier,
    ),
    term(usage.output_tokens, model.output_price_per_mtok_micro_usd, "1"),
  ];
  let scale = Math.max(...terms.map((t) => t.scale));
  let total = terms.reduce((s, t) => s + toScale(t, scale), 0n);

  if (options.batch === true) {
    const d = parseDecimal(model.batch_discount);
    // × (1 − discount)
    const keep = 10n ** BigInt(d.scale) - d.unscaled;
    total *= keep;
    scale += d.scale;
  }
  // tokens × micro-USD per million tokens → divide by 1e6 and by 10^scale, rounding up.
  return microUsd(divideRounded(total, 1_000_000n * 10n ** BigInt(scale), "ceil"));
}

/** Upper bound for a call before it is made: counted input at full input price plus max_tokens at output price. */
export function projectedCallCostMicroUsd(
  inputTokens: number,
  maxTokens: number,
  model: ModelRow,
): MicroUsd {
  return costMicroUsd({ input_tokens: inputTokens, output_tokens: maxTokens }, model);
}

export interface FxConfig {
  readonly inr_per_usd: string;
  readonly buffer_percent: string;
}

export function costPaise(
  cost: MicroUsd,
  fx: FxConfig,
): { paise: Paise; rateUsed: string } {
  const rate = fxRate(fx.inr_per_usd, fx.buffer_percent);
  const r = rate.inrPerUsd;
  const b = rate.bufferPercent;
  // Effective rate as a decimal string for the ai_calls.fx_rate_used column (numeric(12,6)).
  const unscaled = r.unscaled * (100n * 10n ** BigInt(b.scale) + b.unscaled);
  const scale = r.scale + b.scale + 2;
  const six = divideRounded(unscaled * 1_000_000n, 10n ** BigInt(scale), "ceil");
  const s = six.toString().padStart(7, "0");
  return {
    paise: microUsdToPaise(cost, rate, "ceil"),
    rateUsed: `${s.slice(0, -6)}.${s.slice(-6)}`,
  };
}
