/**
 * Pricing engine (SPEC §12).
 *
 *   price = round_to_config(base × tier_multiplier + (instant ? surcharge : 0))
 *   ai_cost_cap_paise = price × 100 × max_ai_cost_ratio
 *   quote credits = round_up_to_endings(p90_cost_inr / max_ai_cost_ratio)
 *
 * All arithmetic is exact: multipliers and ratios are decimal strings parsed to scaled
 * integers (packages/core/money), so no floating point touches a price.
 */

import {
  divideRounded,
  multiplyByDecimal,
  parseDecimal,
  roundUpToEnding,
  type RoundingMode,
} from "@magicmis/core/money";
import { readConfig } from "@magicmis/db/config";
import type { Queryable } from "@magicmis/db/tx";
import { z } from "zod";

export type Tier = "efficient" | "professional" | "expert";
export type DeliveryMode = "standard" | "instant";

export const ACTION_KEYS = [
  "data_diagnostic",
  "company_setup",
  "reference_mis_recreate",
  "monthly_refresh",
  "refresh_with_restructure",
  "dashboard_addon",
  "dashboard_refresh",
  "commentary",
  "chat_quick",
  "chat_deep",
  "chat_edit",
  "company_memory_monthly",
  "company_restore",
  "cancel_after_ai_fee",
] as const;
export type ActionKey = (typeof ACTION_KEYS)[number];

const decimalString = z.string().regex(/^\d+(\.\d+)?$/u);

export const priceBookRowSchema = z.object({
  action_key: z.enum(ACTION_KEYS),
  base_credits: z.coerce.bigint(),
  tier_multipliers: z.object({
    efficient: decimalString,
    professional: decimalString,
    expert: decimalString,
  }),
  instant_surcharge_credits: z.coerce.bigint(),
  max_ai_cost_ratio: decimalString,
  reservation_mode: z.enum(["fixed", "capped"]),
  price_from_action_key: z.enum(ACTION_KEYS).nullable(),
  enabled: z.boolean(),
  version: z.number().int(),
});

export type PriceBookRow = z.infer<typeof priceBookRowSchema>;

export class PricingError extends Error {
  constructor(
    readonly code:
      "action_not_priced" | "action_disabled" | "tier_not_available" | "price_loop",
    message: string,
  ) {
    super(message);
    this.name = "PricingError";
  }
}

/** The price book row in effect for an action at `at`. */
export async function priceBookEntry(
  db: Queryable,
  actionKey: ActionKey,
  at = new Date(),
): Promise<PriceBookRow> {
  const result = await db.query(
    `select action_key, base_credits::text as base_credits, tier_multipliers,
            instant_surcharge_credits::text as instant_surcharge_credits,
            max_ai_cost_ratio::text as max_ai_cost_ratio, reservation_mode,
            price_from_action_key, enabled, version
     from public.price_book
     where action_key = $1 and effective_from <= $2
     order by version desc limit 1`,
    [actionKey, at],
  );
  const row = result.rows[0] as unknown;
  if (row === undefined)
    throw new PricingError("action_not_priced", `No price book entry for ${actionKey}`);
  return priceBookRowSchema.parse(row);
}

export interface Quote {
  readonly actionKey: ActionKey;
  readonly tier: Tier;
  readonly delivery: DeliveryMode;
  readonly credits: bigint;
  readonly aiCostCapPaise: bigint;
  readonly reservationMode: "fixed" | "capped";
  readonly priceBookVersion: number;
}

/** The pure formula, given a resolved row. */
export function computePrice(
  row: PriceBookRow,
  tier: Tier,
  delivery: DeliveryMode,
  roundingMode: RoundingMode,
): bigint {
  // base × multiplier + surcharge, rounded once at the end (SPEC §12).
  const multiplier = parseDecimal(row.tier_multipliers[tier]);
  const surcharge = delivery === "instant" ? row.instant_surcharge_credits : 0n;
  const scale = 10n ** BigInt(multiplier.scale);
  const unrounded = row.base_credits * multiplier.unscaled + surcharge * scale;
  return divideRounded(unrounded, scale, roundingMode);
}

/** ai_cost_cap_paise = price × 100 × ratio, rounded down so the cap never exceeds the rule. */
export function aiCostCapPaise(priceCredits: bigint, maxAiCostRatio: string): bigint {
  return multiplyByDecimal(priceCredits * 100n, parseDecimal(maxAiCostRatio), "floor");
}

/**
 * Credits for an over-cap quote: p90 cost in rupees divided by the ratio, rounded up, then
 * up again to the configured endings (SPEC §12 `round_up_to_49_or_99`).
 */
export function quoteCreditsFor(
  p90CostPaise: bigint,
  maxAiCostRatio: string,
  endings: readonly number[],
): bigint {
  const ratio = parseDecimal(maxAiCostRatio);
  // credits = (paise / 100) / (unscaled / 10^scale) = paise × 10^scale / (100 × unscaled)
  const base = divideRounded(
    p90CostPaise * 10n ** BigInt(ratio.scale),
    100n * ratio.unscaled,
    "ceil",
  );
  return roundUpToEnding(base < 1n ? 1n : base, endings);
}

/**
 * The exact credit price for an action. Expert+ is never priced here: SPEC §2.10 makes it
 * available only as an admin-issued quote.
 */
export async function priceFor(
  db: Queryable,
  input: {
    actionKey: ActionKey;
    tier: Tier | "expert_plus";
    delivery: DeliveryMode;
    at?: Date;
  },
): Promise<Quote> {
  if (input.tier === "expert_plus") {
    throw new PricingError(
      "tier_not_available",
      "Expert+ is available only by admin-issued quote",
    );
  }
  const at = input.at ?? new Date();
  const own = await priceBookEntry(db, input.actionKey, at);
  if (!own.enabled)
    throw new PricingError("action_disabled", `${input.actionKey} is disabled`);

  let source = own;
  if (own.price_from_action_key !== null) {
    source = await priceBookEntry(db, own.price_from_action_key, at);
    if (source.price_from_action_key !== null) {
      throw new PricingError(
        "price_loop",
        `${input.actionKey} prices from an action that itself delegates`,
      );
    }
  }

  const rounding = await readConfig(
    db,
    "pricing.rounding_mode",
    z.enum(["half_up", "half_even", "ceil", "floor", "trunc", "expand"]),
  );
  const credits = computePrice(source, input.tier, input.delivery, rounding);
  return {
    actionKey: input.actionKey,
    tier: input.tier,
    delivery: input.delivery,
    credits,
    aiCostCapPaise: aiCostCapPaise(credits, own.max_ai_cost_ratio),
    reservationMode: own.reservation_mode,
    priceBookVersion: own.version,
  };
}

export interface PriceListRow {
  readonly actionKey: ActionKey;
  readonly standard: Readonly<Record<Tier, bigint>>;
  /** Present only where the action has an instant surcharge. */
  readonly instant: Readonly<Record<Tier, bigint>> | null;
}

/**
 * The public price list (SPEC §2.3: viewing the price book is uncharged). Credits only —
 * never the AI cost cap or ratio, which users must not see (SPEC §2.5).
 */
export async function priceList(db: Queryable, at = new Date()): Promise<PriceListRow[]> {
  const rows: PriceListRow[] = [];
  for (const actionKey of ACTION_KEYS) {
    const entry = await priceBookEntry(db, actionKey, at).catch((error: unknown) => {
      if (error instanceof PricingError) return null;
      throw error;
    });
    if (entry === null || !entry.enabled) continue;
    const price = async (tier: Tier, delivery: DeliveryMode) =>
      (await priceFor(db, { actionKey, tier, delivery, at })).credits;
    const standard = {
      efficient: await price("efficient", "standard"),
      professional: await price("professional", "standard"),
      expert: await price("expert", "standard"),
    };
    const source =
      entry.price_from_action_key === null
        ? entry
        : await priceBookEntry(db, entry.price_from_action_key, at);
    const instant =
      source.instant_surcharge_credits > 0n
        ? {
            efficient: await price("efficient", "instant"),
            professional: await price("professional", "instant"),
            expert: await price("expert", "instant"),
          }
        : null;
    rows.push({ actionKey, standard, instant });
  }
  return rows;
}
