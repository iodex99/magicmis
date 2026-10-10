/**
 * ADR 0087: the statutory statements on random books. Nothing in them is a balancing figure, so
 * the only proof that every head lands in exactly one line is that the two sides of each balance
 * sheet agree in every month, and the profit at the foot of each profit and loss is the engine's
 * own PAT — for the month and for the year to date — whatever the books hold and wherever the
 * year ends.
 */

import type { StatutoryFormat } from "@magicmis/core/reporting-conventions";
import type { PeriodId } from "@magicmis/core/time";
import { MetricEngine, type HeadCube } from "@magicmis/engine";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { balancedOpenings, booksArbitrary, keepBooks } from "../../engine/test/books";
import { cubeFor, mapFacts } from "../../engine/test/pipeline";
import { openTestDuck } from "../../ingest/test/duck";
import {
  lineValue,
  statutoryColumns,
  statutoryStatements,
  type StatutoryColumn,
  type StatutoryStatement,
} from "../src/statutory";

let duck: Awaited<ReturnType<typeof openTestDuck>> | undefined;
beforeAll(async () => {
  duck = await openTestDuck();
});
afterAll(() => {
  duck?.close();
});

/** Each row's value in a column, as the sheet computes it: lines from heads, totals from rows. */
function evaluate(
  cube: HeadCube,
  statement: StatutoryStatement,
  column: StatutoryColumn,
): Map<string, bigint | null> {
  const out = new Map<string, bigint | null>();
  for (const row of statement.rows) {
    if (row.kind === "line")
      out.set(row.id, lineValue(cube, statement, row.terms, row.credit, column));
    else if (row.kind === "total") {
      let sum: bigint | null = 0n;
      for (const [sign, id] of row.of) {
        const v = out.get(id) ?? null;
        sum = sum === null || v === null ? null : sum + (sign === 1 ? v : -v);
      }
      out.set(row.id, sum);
    }
  }
  return out;
}

const SIDES: Record<Exclude<StatutoryFormat, "none">, [string, string, string]> = {
  schedule_iii: ["assets_total", "equity_and_liabilities_total", "profit"],
  uk_companies_act: ["net_assets", "shareholders_funds", "profit"],
  us_gaap: ["assets_total", "liabilities_and_equity_total", "net_income"],
  ifrs: ["assets_total", "equity_and_liabilities_total", "profit"],
};

const pat = (engine: MetricEngine, period: PeriodId, ytd: boolean): bigint | null => {
  const v = ytd
    ? engine.comparisons("pat", period, ["ytd"]).find((x) => x.metricId === "pat.ytd")
    : engine.evaluate("pat", period);
  return v?.value == null ? null : BigInt(v.value);
};

describe("statutory statements on random books (ADR 0087)", () => {
  it("balance in every layout and month, and end in the engine's PAT", async () => {
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
          for (const [format, [assets, claims, profit]] of Object.entries(SIDES)) {
            const [position, performance] = statutoryStatements(
              format as StatutoryFormat,
            );
            if (position === undefined || performance === undefined)
              throw new Error(`${format} has no statements`);
            for (const period of cube.periods) {
              const label = (p: PeriodId) => p;
              for (const column of statutoryColumns(position, period, cube, label)) {
                const rows = evaluate(cube, position, column);
                const left = rows.get(assets);
                expect(left, `${format} ${column.header}`).not.toBeUndefined();
                expect(left, `${format} ${column.header}`).toBe(rows.get(claims));
              }
              for (const column of statutoryColumns(performance, period, cube, label)) {
                const rows = evaluate(cube, performance, column);
                expect(rows.get(profit) ?? null, `${format} ${column.header}`).toBe(
                  pat(engine, column.period, column.kind === "ytd"),
                );
              }
            }
          }
        },
      ),
      { numRuns: 30 },
    );
  });
});
