/**
 * ADR 0086: the cash flow adds up. Operating, investing and financing are each built from profit,
 * depreciation and movements in the balance sheet, never as a balancing figure — so the only proof
 * that they cover everything is that they always come to the movement in cash and bank. These
 * check it on the three fixture companies across a real April year end, and on random books.
 */

import { addMonths, type PeriodId } from "@magicmis/core/time";
import { buildFixtureSet } from "@magicmis/fixtures";
import { ledgerKey } from "@magicmis/semantic";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openTestDuck } from "../../ingest/test/duck";
import type { LedgerFact } from "../src/facts";
import { MetricEngine } from "../src/metrics";
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

/** Ledgers in Tally's own groups, so the cascade maps them as it maps real books. */
const LEDGERS = [
  { name: "Cash", group: "Cash-in-hand", pl: false },
  { name: "Example Bank", group: "Bank Accounts", pl: false },
  { name: "Customer A", group: "Sundry Debtors", pl: false },
  { name: "Closing Stock", group: "Stock-in-hand", pl: false },
  { name: "Advance to staff", group: "Loans & Advances (Asset)", pl: false },
  { name: "Supplier A", group: "Sundry Creditors", pl: false },
  { name: "Output GST", group: "Duties & Taxes", pl: false },
  { name: "Term loan", group: "Secured Loans", pl: false },
  { name: "Furniture", group: "Fixed Assets", pl: false },
  { name: "Mutual fund", group: "Investments", pl: false },
  { name: "Capital", group: "Capital Account", pl: false },
  { name: "Profit & Loss A/c", group: "Profit & Loss A/c", pl: false },
  { name: "Odd balance", group: "Zzqx Holding", pl: false },
  { name: "Sales", group: "Sales Accounts", pl: true },
  { name: "Purchases", group: "Purchase Accounts", pl: true },
  { name: "Rent", group: "Indirect Expenses", pl: true },
  { name: "Depreciation", group: "Indirect Expenses", pl: true },
  { name: "Interest received", group: "Indirect Incomes", pl: true },
] as const;
const PROFIT_AND_LOSS_AC = LEDGERS.findIndex((l) => l.name === "Profit & Loss A/c");

const posting = fc.record({
  debit: fc.integer({ min: 0, max: LEDGERS.length - 1 }),
  credit: fc.integer({ min: 0, max: LEDGERS.length - 1 }),
  amount: fc.bigInt({ min: 1n, max: 10n ** 9n }),
});

/**
 * Books kept the way Tally keeps them: balance-sheet ledgers carry forward, profit-and-loss
 * ledgers are cumulative within the year and restart in April with the closed year's result moved
 * into the Profit & Loss A/c. Each month's trial balance balances because every posting is a
 * debit and a credit of the same amount.
 */
function keepBooks(
  openings: readonly bigint[],
  months: readonly (readonly { debit: number; credit: number; amount: bigint }[])[],
  first: PeriodId,
): LedgerFact[] {
  const facts: LedgerFact[] = [];
  const balance = [...openings];
  let period = first;
  for (const postings of months) {
    if (period.endsWith("-04")) {
      const result = LEDGERS.reduce((s, l, i) => (l.pl ? s + (balance[i] ?? 0n) : s), 0n);
      LEDGERS.forEach((l, i) => {
        if (l.pl) balance[i] = 0n;
      });
      balance[PROFIT_AND_LOSS_AC] = (balance[PROFIT_AND_LOSS_AC] ?? 0n) + result;
    }
    const opening = [...balance];
    for (const p of postings) {
      if (p.debit === p.credit) continue;
      balance[p.debit] = (balance[p.debit] ?? 0n) + p.amount;
      balance[p.credit] = (balance[p.credit] ?? 0n) - p.amount;
    }
    LEDGERS.forEach((l, i) => {
      facts.push({
        ledgerKey: ledgerKey({ groupPath: [l.group], name: l.name }),
        name: l.name,
        groupPath: [l.group],
        period,
        opening: opening[i] ?? 0n,
        debit: null,
        credit: null,
        closing: balance[i] ?? 0n,
        source: { fileId: "books", sheet: period, sourceRow: i + 1 },
      });
    });
    period = addMonths(period, 1);
  }
  return facts;
}

describe("random books", () => {
  it("always come to the movement in cash, whatever moves and wherever the year ends", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Openings that balance: everything against capital.
        fc.array(fc.bigInt({ min: 0n, max: 10n ** 9n }), {
          minLength: LEDGERS.length,
          maxLength: LEDGERS.length,
        }),
        fc.array(fc.array(posting, { maxLength: 12 }), { minLength: 2, maxLength: 7 }),
        fc.constantFrom(
          "2025-01",
          "2025-02",
          "2025-03",
          "2025-04",
        ) as fc.Arbitrary<PeriodId>,
        async (raw, months, first) => {
          if (duck === undefined) throw new Error("duck not open");
          const openings = raw.map((x, i) => (LEDGERS[i]?.pl === true ? 0n : x));
          const capital = LEDGERS.findIndex((l) => l.name === "Capital");
          openings[capital] = -openings.reduce(
            (s, x, i) => (i === capital ? s : s + x),
            0n,
          );
          const facts = keepBooks(openings, months, first);
          const cube = await cubeFor(duck, facts, mapFacts(facts).mappings);
          const engine = new MetricEngine(cube);
          expect(expectItAddsUp(engine, cube.periods)).toBe(cube.periods.length);
        },
      ),
      { numRuns: 40 },
    );
  });
});
