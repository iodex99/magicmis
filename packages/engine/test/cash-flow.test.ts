/**
 * ADR 0086: the cash flow adds up. Operating, investing and financing are each built from profit,
 * depreciation and movements in the balance sheet, never as a balancing figure — so the only proof
 * that they cover everything is that they always come to the movement in cash and bank. These
 * check it on the three fixture companies across a real April year end, and on random books.
 */

import type { PeriodId } from "@magicmis/core/time";
import { buildFixtureSet } from "@magicmis/fixtures";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openTestDuck } from "../../ingest/test/duck";
import { MetricEngine } from "../src/metrics";
import { balancedOpenings, booksArbitrary, keepBooks } from "./books";
import { cubeFor, mapFacts, parseTb } from "./pipeline";

let duck: Awaited<ReturnType<typeof openTestDuck>> | undefined;
beforeAll(async () => {
  duck = await openTestDuck();
});
afterAll(() => {
  duck?.close();
});

const value = (engine: MetricEngine, id: string, period: PeriodId): bigint | null => {
  const v = engine.evaluate(id, period).value;
  return v === null ? null : BigInt(v);
};

/** Every month: start + operating + investing + financing = end, and the year to date too. */
function expectItAddsUp(engine: MetricEngine, periods: readonly PeriodId[]): number {
  let checked = 0;
  for (const p of periods) {
    const opening = value(engine, "cash_opening", p);
    const closing = value(engine, "cash_and_bank", p);
    const sections = ["cf_operating", "cf_investing", "cf_financing"].map((id) =>
      value(engine, id, p),
    );
    const net = value(engine, "cf_net", p);
    if (opening === null || closing === null || net === null) continue;
    expect(
      sections.reduce<bigint>((s, x) => s + (x ?? 0n), 0n),
      p,
    ).toBe(net);
    expect(opening + net, p).toBe(closing);
    checked += 1;
  }
  return checked;
}

const set = buildFixtureSet();

describe.each(set.truths.map((t) => [t.company] as const))("%s", (company) => {
  it("every month's cash flow comes to the movement in cash, across the year end", async () => {
    if (duck === undefined) throw new Error("duck not open");
    const files = set.files
      .filter(
        (f) =>
          f.company === company && f.report === "trial_balance" && f.variant === "clean",
      )
      .sort((a, b) => a.period.to.localeCompare(b.period.to));
    const facts = files.flatMap((f) => parseTb(f).facts);
    const cube = await cubeFor(duck, facts, mapFacts(facts).mappings);
    const engine = new MetricEngine(cube);
    // Every month after the first. The first export does not report an opening for every
    // ledger, so that month has no movements to state and is left empty rather than guessed.
    expect(expectItAddsUp(engine, cube.periods)).toBe(13);

    // April 2026 opens a year: the year's profit moves into reserves and no cash moves with it.
    const april = "2026-04" as PeriodId;
    expect(value(engine, "cf_profit_carried", april)).not.toBe(0n);
    expect(value(engine, "cf_profit_carried", "2026-05" as PeriodId)).toBe(0n);

    // The year to date is the year's movement in cash.
    const ytd = engine
      .comparisons("cf_net", "2026-05" as PeriodId, ["ytd"])
      .find((v) => v.metricId === "cf_net.ytd")?.value;
    const start = value(engine, "cash_opening", april);
    const end = value(engine, "cash_and_bank", "2026-05" as PeriodId);
    expect(ytd).toBeTypeOf("string");
    expect(BigInt(ytd ?? "0")).toBe((end ?? 0n) - (start ?? 0n));
  });
});

describe("random books", () => {
  it("always come to the movement in cash, whatever moves and wherever the year ends", async () => {
    await fc.assert(
      fc.asyncProperty(
        booksArbitrary.openings,
        booksArbitrary.months,
        booksArbitrary.first,
        async (raw, months, first) => {
          if (duck === undefined) throw new Error("duck not open");
          const facts = keepBooks(balancedOpenings(raw), months, first);
          const cube = await cubeFor(duck, facts, mapFacts(facts).mappings);
          const engine = new MetricEngine(cube);
          expect(expectItAddsUp(engine, cube.periods)).toBe(cube.periods.length);
        },
      ),
      { numRuns: 40 },
    );
  });
});
