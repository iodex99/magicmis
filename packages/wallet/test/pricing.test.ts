import { randomUUID } from "node:crypto";

import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  aiCostCapPaise,
  computePrice,
  priceFor,
  PricingError,
  quoteCreditsFor,
  type PriceBookRow,
} from "../src/pricing";
import { createQuote, decideQuote, expireQuotes } from "../src/quotes";

let db: TestDb | undefined;
beforeAll(async () => {
  db = await startTestDb();
}, 180_000);
afterAll(async () => {
  await db?.stop();
});
function testDb(): TestDb {
  if (db === undefined) throw new Error("test database was not started");
  return db;
}

const row = (overrides: Partial<PriceBookRow> = {}): PriceBookRow => ({
  action_key: "company_setup",
  base_credits: 999n,
  tier_multipliers: { efficient: "0.8", professional: "1.0", expert: "2.5" },
  instant_surcharge_credits: 0n,
  max_ai_cost_ratio: "0.2000",
  reservation_mode: "fixed",
  price_from_action_key: null,
  enabled: true,
  version: 1,
  ...overrides,
});

describe("price formula (SPEC §12)", () => {
  it("applies tier multipliers exactly and rounds once", () => {
    expect(computePrice(row(), "efficient", "standard", "half_up")).toBe(799n); // 799.2
    expect(computePrice(row(), "professional", "standard", "half_up")).toBe(999n);
    expect(computePrice(row(), "expert", "standard", "half_up")).toBe(2498n); // 2497.5
    expect(computePrice(row(), "expert", "standard", "half_even")).toBe(2498n); // 2497.5 → even
  });

  it("adds the instant surcharge before rounding", () => {
    const commentary = row({
      action_key: "commentary",
      base_credits: 149n,
      instant_surcharge_credits: 49n,
    });
    expect(computePrice(commentary, "professional", "standard", "half_up")).toBe(149n);
    expect(computePrice(commentary, "professional", "instant", "half_up")).toBe(198n);
    expect(computePrice(commentary, "efficient", "instant", "half_up")).toBe(168n); // 119.2 + 49 = 168.2
  });

  it("caps AI cost at price × 100 × ratio, rounding down", () => {
    expect(aiCostCapPaise(999n, "0.2000")).toBe(19_980n);
    expect(aiCostCapPaise(19n, "0.2000")).toBe(380n);
    expect(aiCostCapPaise(799n, "0.15")).toBe(11_985n);
  });

  it("property: the AI cost cap never exceeds the ratio of the price", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 1_000_000n }),
        fc.integer({ min: 1, max: 9999 }),
        (price, bp) => {
          const ratio = `0.${String(bp).padStart(4, "0")}`;
          const cap = aiCostCapPaise(price, ratio);
          return cap * 10_000n <= price * 100n * BigInt(bp);
        },
      ),
    );
  });

  it("prices a quote so the estimate lands at or under the ratio, rounded up to 49/99", () => {
    // ₹300 estimated p90 at a 0.20 ratio needs ≥ 1500 credits → 1549.
    expect(quoteCreditsFor(30_000n, "0.20", [49, 99])).toBe(1549n);
    // ₹300.01 → 1500.05 → ceil 1501 → 1549.
    expect(quoteCreditsFor(30_001n, "0.20", [49, 99])).toBe(1549n);
    // Tiny estimates still yield a positive quote.
    expect(quoteCreditsFor(1n, "0.20", [49, 99])).toBe(49n);
  });

  it("property: a quote always leaves AI cost within the cap it implies", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 10_000_000n }), (p90) => {
        const credits = quoteCreditsFor(p90, "0.20", [49, 99]);
        return aiCostCapPaise(credits, "0.20") >= p90;
      }),
    );
  });
});

describe("price book in the database", () => {
  it("prices every seeded action for every public tier", async () => {
    const pool = testDb().pool;
    const expected: Record<string, bigint> = {
      data_diagnostic: 299n,
      company_setup: 999n,
      monthly_refresh: 299n,
      chat_quick: 19n,
      company_memory_monthly: 99n,
    };
    for (const [actionKey, credits] of Object.entries(expected)) {
      const quote = await priceFor(pool, {
        actionKey: actionKey as never,
        tier: "professional",
        delivery: "standard",
      });
      expect(quote.credits, actionKey).toBe(credits);
    }
  });

  it("prices cancel_after_ai_fee from data_diagnostic at the same tier (SPEC §12)", async () => {
    const pool = testDb().pool;
    for (const tier of ["efficient", "professional", "expert"] as const) {
      const fee = await priceFor(pool, {
        actionKey: "cancel_after_ai_fee",
        tier,
        delivery: "standard",
      });
      const diagnostic = await priceFor(pool, {
        actionKey: "data_diagnostic",
        tier,
        delivery: "standard",
      });
      expect(fee.credits, tier).toBe(diagnostic.credits);
    }
  });

  it("does not tier the monthly memory fee", async () => {
    const pool = testDb().pool;
    const efficient = await priceFor(pool, {
      actionKey: "company_memory_monthly",
      tier: "efficient",
      delivery: "standard",
    });
    const expert = await priceFor(pool, {
      actionKey: "company_memory_monthly",
      tier: "expert",
      delivery: "standard",
    });
    expect(efficient.credits).toBe(99n);
    expect(expert.credits).toBe(99n);
  });

  it("never prices Expert+ — admin-issued quotes only (SPEC §2.10)", async () => {
    await expect(
      priceFor(testDb().pool, {
        actionKey: "company_setup",
        tier: "expert_plus",
        delivery: "standard",
      }),
    ).rejects.toThrow(PricingError);
  });

  it("uses the newest version in effect, and ignores a future one", async () => {
    const pool = testDb().pool;
    await pool.query(
      `insert into price_book (action_key, base_credits, tier_multipliers, max_ai_cost_ratio, version, effective_from)
       values ('chat_edit', 25, '{"efficient":"0.8","professional":"1.0","expert":"2.5"}', 0.2, 2, now() - interval '1 minute'),
              ('chat_edit', 99, '{"efficient":"0.8","professional":"1.0","expert":"2.5"}', 0.2, 3, now() + interval '1 day')`,
    );
    const quote = await priceFor(pool, {
      actionKey: "chat_edit",
      tier: "professional",
      delivery: "standard",
    });
    expect(quote.credits).toBe(25n);
    expect(quote.priceBookVersion).toBe(2);
  });

  it("refuses a disabled action", async () => {
    const pool = testDb().pool;
    await pool.query(
      `insert into price_book (action_key, base_credits, tier_multipliers, max_ai_cost_ratio, version, enabled)
       values ('dashboard_refresh', 99, '{"efficient":"0.8","professional":"1.0","expert":"2.5"}', 0.2, 2, false)`,
    );
    await expect(
      priceFor(pool, {
        actionKey: "dashboard_refresh",
        tier: "professional",
        delivery: "standard",
      }),
    ).rejects.toThrow(/disabled/u);
  });
});

describe("quotes (SPEC §12)", () => {
  async function account(): Promise<string> {
    const r = await testDb().pool.query<{ id: string }>(
      `insert into accounts (auth_user_id, email, business_name, state_code) values (gen_random_uuid(), $1, 'Q', '27') returning id`,
      [`${randomUUID()}@example.test`],
    );
    return r.rows[0]?.id ?? "";
  }

  it("is valid for the configured window and accepted once", async () => {
    const pool = testDb().pool;
    const accountId = await account();
    const now = new Date("2026-05-01T10:00:00Z");
    const { quoteId, expiresAt } = await createQuote(pool, {
      accountId,
      jobId: null,
      reason: "estimate_over_cap",
      credits: 1549n,
      now,
    });
    expect(expiresAt.toISOString()).toBe("2026-05-02T10:00:00.000Z");
    expect(
      await decideQuote(pool, { quoteId, accountId, decision: "accept", now }),
    ).toEqual({ status: "accepted", credits: 1549n });
    expect(
      await decideQuote(pool, { quoteId, accountId, decision: "accept", now }),
    ).toEqual({ status: "already_decided", current: "accepted" });
  });

  it("cannot be accepted after expiry or by another account", async () => {
    const pool = testDb().pool;
    const accountId = await account();
    const now = new Date("2026-05-01T10:00:00Z");
    const { quoteId } = await createQuote(pool, {
      accountId,
      jobId: null,
      reason: "runtime_cap",
      credits: 499n,
      now,
    });
    expect(
      await decideQuote(pool, {
        quoteId,
        accountId: await account(),
        decision: "accept",
        now,
      }),
    ).toEqual({ status: "not_found" });
    expect(
      await decideQuote(pool, {
        quoteId,
        accountId,
        decision: "accept",
        now: new Date("2026-05-02T10:00:01Z"),
      }),
    ).toEqual({ status: "expired" });
  });

  it("sweeps offered quotes past expiry", async () => {
    const pool = testDb().pool;
    const accountId = await account();
    const now = new Date("2026-06-01T00:00:00Z");
    await createQuote(pool, {
      accountId,
      jobId: null,
      reason: "restructure",
      credits: 599n,
      now,
    });
    expect(
      await expireQuotes(pool, new Date("2026-06-03T00:00:00Z")),
    ).toBeGreaterThanOrEqual(1);
  });
});
