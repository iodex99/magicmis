/**
 * SPEC §34 Phase 4 acceptance: recorded cost matches cost computed from usage. These are the
 * computations; test/orchestrator.test.ts checks the recorded ai_calls rows against them.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { costMicroUsd, costPaise, projectedCallCostMicroUsd } from "../src/cost";
import type { ModelRow } from "../src/registry";

const model = (over: Partial<ModelRow> = {}): ModelRow => ({
  model_id: "claude-sonnet-5",
  input_price_per_mtok_micro_usd: 2_000_000n,
  output_price_per_mtok_micro_usd: 10_000_000n,
  cache_read_multiplier: "0.1000",
  cache_write_multiplier: "1.2500",
  cache_write_1h_multiplier: "2.0000",
  batch_discount: "0.5000",
  available: true,
  version: 1,
  source_url: "https://platform.claude.com/docs/en/about-claude/pricing",
  verified_at: new Date("2026-09-13T00:00:00Z"),
  ...over,
});

describe("costMicroUsd", () => {
  it("prices input and output per million tokens", () => {
    // 1M input × $2 + 100k output × $10 = $2 + $1 = 3,000,000 µ$
    expect(
      costMicroUsd({ input_tokens: 1_000_000, output_tokens: 100_000 }, model()),
    ).toBe(3_000_000n);
  });

  it("prices 5-minute and 1-hour cache writes and cache reads", () => {
    const usage = {
      input_tokens: 1000,
      output_tokens: 500,
      cache_creation_input_tokens: 3000,
      cache_read_input_tokens: 10_000,
      cache_creation: {
        ephemeral_5m_input_tokens: 2000,
        ephemeral_1h_input_tokens: 1000,
      },
    };
    // At $2/MTok one input token costs 2 µ$. input 1000×2 = 2000; 5m writes 2000×2×1.25 = 5000;
    // 1h writes 1000×2×2 = 4000; reads 10000×2×0.1 = 2000; output 500×10 = 5000 → 18000 µ$.
    expect(costMicroUsd(usage, model())).toBe(18_000n);
  });

  it("treats cache writes without a breakdown as 5-minute writes", () => {
    expect(
      costMicroUsd(
        { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1000 },
        model(),
      ),
    ).toBe(2500n);
  });

  it("applies Fable 5.1's cache read multiplier", () => {
    const fable = model({
      model_id: "claude-fable-5-1",
      input_price_per_mtok_micro_usd: 10_000_000n,
      output_price_per_mtok_micro_usd: 50_000_000n,
      cache_read_multiplier: "0.0250",
    });
    expect(
      costMicroUsd(
        { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 100_000 },
        fable,
      ),
    ).toBe(25_000n);
  });

  it("applies the batch discount to everything", () => {
    const usage = { input_tokens: 1_000_000, output_tokens: 100_000 };
    expect(costMicroUsd(usage, model(), { batch: true })).toBe(1_500_000n);
  });

  it("rounds up once, never down", () => {
    // Haiku input $1/MTok: 1 token = 1 µ$; 1 cache read = 0.1 µ$ → 1.
    const haiku = model({
      input_price_per_mtok_micro_usd: 1_000_000n,
      output_price_per_mtok_micro_usd: 5_000_000n,
    });
    expect(
      costMicroUsd(
        { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1 },
        haiku,
      ),
    ).toBe(1n);
    // Ten reads sum to exactly 1 µ$, not 10 separately rounded.
    expect(
      costMicroUsd(
        { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 10 },
        haiku,
      ),
    ).toBe(1n);
  });

  it("rejects an inconsistent cache breakdown and negative counts", () => {
    expect(() =>
      costMicroUsd(
        {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 10,
          cache_creation: { ephemeral_5m_input_tokens: 3, ephemeral_1h_input_tokens: 3 },
        },
        model(),
      ),
    ).toThrow(RangeError);
    expect(() => costMicroUsd({ input_tokens: -1, output_tokens: 0 }, model())).toThrow(
      RangeError,
    );
  });

  const usageArb = fc.record({
    input_tokens: fc.nat(2_000_000),
    output_tokens: fc.nat(200_000),
    cache_creation_input_tokens: fc.nat(500_000),
    cache_read_input_tokens: fc.nat(2_000_000),
  });

  it("property: never negative and monotone in every token count", () => {
    fc.assert(
      fc.property(
        usageArb,
        fc.constantFrom(
          "input_tokens",
          "output_tokens",
          "cache_creation_input_tokens",
          "cache_read_input_tokens",
        ),
        fc.nat(10_000),
        (u, key, extra) => {
          const base = costMicroUsd(u, model());
          const more = costMicroUsd({ ...u, [key]: u[key] + extra }, model());
          expect(base >= 0n).toBe(true);
          expect(more >= base).toBe(true);
        },
      ),
    );
  });

  it("property: batch cost is at most half of standard, rounded up", () => {
    fc.assert(
      fc.property(usageArb, (u) => {
        const std = costMicroUsd(u, model());
        const batch = costMicroUsd(u, model(), { batch: true });
        expect(batch <= std / 2n + 1n).toBe(true);
      }),
    );
  });

  it("projected cost is input at full price plus max_tokens at output price", () => {
    expect(projectedCallCostMicroUsd(10_000, 4_000, model())).toBe(20_000n + 40_000n);
  });
});

describe("costPaise", () => {
  it("converts at the FX rate plus buffer, rounding up", () => {
    // $1 at ₹95 + 3% = ₹97.85 = 9785 paise.
    const r = costPaise(1_000_000n as never, {
      inr_per_usd: "95.00",
      buffer_percent: "3",
    });
    expect(r.paise).toBe(9785n);
    expect(r.rateUsed).toBe("97.850000");
  });

  it("never rounds a non-zero cost to zero paise", () => {
    expect(
      costPaise(1n as never, { inr_per_usd: "95.00", buffer_percent: "3" }).paise,
    ).toBe(1n);
  });
});
