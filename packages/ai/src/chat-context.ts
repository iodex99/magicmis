/**
 * The AI budget for one chat message (SPEC §12, §27): the cap is the message's price times the
 * action's `max_ai_cost_ratio`, seeded with what the message has already spent (earlier Deep
 * rounds, or a thread summary absorbed into it).
 */

import { aiCostCapPaise, priceBookEntry, type ActionKey } from "@magicmis/wallet";
import type { Pool } from "pg";

import { CostBudget, type AiContext } from "./orchestrator";
import type { AiTransport } from "./transport";

const ACTION: Record<string, ActionKey> = {
  quick: "chat_quick",
  deep: "chat_deep",
  investigate: "chat_deep",
  edit: "chat_edit",
};

export async function chatAiContext(
  pool: Pool,
  transport: AiTransport,
  chatMessageId: string,
): Promise<AiContext> {
  const r = await pool.query<{
    account_id: string;
    message_type: string | null;
    tier: "efficient" | "professional" | "expert" | null;
    price_credits: string | null;
    spent: string;
  }>(
    `select m.account_id, m.message_type, m.tier, m.price_credits::text as price_credits,
            (select coalesce(sum(usd_cost_micro), 0)::text from public.ai_calls c where c.chat_message_id = m.id) as spent
     from public.chat_messages m where m.id = $1 and m.role = 'user'`,
    [chatMessageId],
  );
  const row = r.rows[0];
  const action = ACTION[row?.message_type ?? ""];
  if (row === undefined || action === undefined || row.tier === null || row.price_credits === null)
    throw new Error(`chat message ${chatMessageId} is not a priced user message`);
  const entry = await priceBookEntry(pool, action);
  return {
    db: pool,
    transport,
    accountId: row.account_id,
    jobId: null,
    chatMessageId,
    tier: row.tier,
    budget: new CostBudget(
      aiCostCapPaise(BigInt(row.price_credits), entry.max_ai_cost_ratio),
      BigInt(row.spent),
    ),
  };
}
