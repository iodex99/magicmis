/** Price book margin-impact preview against recent usage (SPEC §26, R-24). */

import { randomUUID } from "node:crypto";

import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import { priceBookEntry } from "@magicmis/wallet";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { priceImpactPreview } from "../src/margin";
import { newAccount } from "./helpers";

let db: TestDb | undefined;
beforeAll(async () => {
  db = await startTestDb();
}, 180_000);
afterAll(async () => {
  await db?.stop();
});
const pool = () => {
  if (db === undefined) throw new Error("test database was not started");
  return db.pool;
};

describe("price book impact preview", () => {
  it("reprices last 30 days of captured usage and flags a cut that breaks the ratio", async () => {
    const account = await newAccount(pool());
    const book = await priceBookEntry(pool(), "monthly_refresh");
    const base = book.base_credits;
    const job = (tier: string, captured: bigint, aiPaise: bigint, quoted = false) =>
      pool().query(
        `insert into jobs (account_id, type, state, tier, idempotency_key, captured_credits, actual_ai_cost_paise, quote_id)
         values ($1, 'monthly_refresh', 'completed', $2, $3, $4, $5, $6)`,
        [account, tier, randomUUID(), captured, aiPaise, quoted ? randomUUID() : null],
      );
    // Two professional refreshes at the book price, AI cost 15% of the price each.
    const aiEach = (base * 100n * 15n) / 100n;
    await job("professional", base, aiEach);
    await job("professional", base, aiEach);
    // A quoted job keeps its quote whatever the book says.
    await job("professional", 5_000n, 10_000n, true);
    // Older than the window: ignored.
    await pool().query(
      `insert into jobs (account_id, type, state, tier, idempotency_key, captured_credits, actual_ai_cost_paise, created_at)
       values ($1, 'monthly_refresh', 'completed', 'professional', $2, 999999, 1, now() - interval '40 days')`,
      [account, randomUUID()],
    );

    const proposal = {
      actionKey: "monthly_refresh" as const,
      baseCredits: base,
      multipliers: book.tier_multipliers,
      instantSurchargeCredits: book.instant_surcharge_credits,
      maxAiCostRatio: book.max_ai_cost_ratio,
      priceFromActionKey: null,
    };
    // Rows get created_at from the database clock, which can run ahead of this process; look from a
    // minute later so the jobs just inserted are always inside the window.
    const at = new Date(Date.now() + 60_000);
    const same = await priceImpactPreview(pool(), proposal, at);
    expect(same.items).toBe(2);
    expect(same.quotedItems).toBe(1);
    expect(same.proposedCredits).toBe(same.currentCredits);
    expect(same.currentCredits).toBe(base * 2n + 5_000n);
    expect(same.flagged).toBe(false);
    expect(same.itemsOverProposedCap).toBe(0);

    // Halving the base doubles the ratio on the two book-priced jobs (15% → 30%, over 20%).
    const half = await priceImpactPreview(
      pool(),
      {
        ...proposal,
        baseCredits: base / 2n,
      },
      at,
    );
    expect(half.proposedCredits).toBe(same.currentCredits - 2n * (base - base / 2n));
    expect(half.itemsOverProposedCap).toBe(2);
    expect(half.aiCostPaise).toBe(same.aiCostPaise);

    // Raising the cap to 0.35 clears the per-item flags at the halved price.
    const relaxed = await priceImpactPreview(
      pool(),
      {
        ...proposal,
        baseCredits: base / 2n,
        maxAiCostRatio: "0.35",
      },
      at,
    );
    expect(relaxed.itemsOverProposedCap).toBe(0);
  });
});
