import { priceFor, type Tier } from "@magicmis/wallet";
import type { Pool } from "pg";

/**
 * What each thing the assistant can do costs, per intelligence tier.
 *
 * The customer chooses a tier, so the customer is shown what that choice costs — in credits,
 * which is the only unit they ever transact in. Never tokens, never a model name and never
 * the AI cost behind it (SPEC §2.5): those are ours to absorb, and a fixed credit price is
 * the promise that we do.
 *
 * Read from the versioned price book on each render rather than cached, so a price change
 * made in the admin console is what the next customer sees.
 */
export type ChatAction = "quick" | "deep" | "edit" | "commentary";

export type ChatPrices = Readonly<Record<ChatAction, Readonly<Record<Tier, string>>>>;

const ACTION_KEYS = {
  quick: "chat_quick",
  deep: "chat_deep",
  edit: "chat_edit",
  commentary: "commentary",
} as const;

const TIERS: readonly Tier[] = ["efficient", "professional", "expert"];

export async function chatPrices(pool: Pool): Promise<ChatPrices> {
  const entries = await Promise.all(
    (Object.keys(ACTION_KEYS) as ChatAction[]).map(async (action) => {
      const byTier = await Promise.all(
        TIERS.map(async (tier) => {
          const quote = await priceFor(pool, {
            actionKey: ACTION_KEYS[action],
            tier,
            delivery: "standard",
          });
          return [tier, quote.credits.toString()] as const;
        }),
      );
      return [action, Object.fromEntries(byTier) as Record<Tier, string>] as const;
    }),
  );
  return Object.fromEntries(entries) as ChatPrices;
}
