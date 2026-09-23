/**
 * Reading the board differently without changing it (ADR 0064).
 *
 * The month picker anchors every box; the lens retargets the window and the comparison around
 * that anchor for the whole board at once. The rule that makes it safe is the one held hardest
 * here: a box that states one month keeps stating one month however wide the range is set,
 * because revenue for five months is not a figure anyone asked for.
 */

import type { PeriodId } from "@magicmis/core/time";
import type { MetricValue } from "@magicmis/engine";
import { describe, expect, it } from "vitest";

import { DEFAULT_DASHBOARD, type Widget } from "../src/spec";
import { buildWidgetView, NO_LENS, type BoardLens, type ViewFormat } from "../src/views";

const MONTHS = [
  "2025-04",
  "2025-05",
  "2025-06",
  "2025-07",
  "2025-08",
  "2025-09",
  "2025-10",
  "2025-11",
  "2025-12",
  "2026-01",
  "2026-02",
  "2026-03",
  "2026-04",
  "2026-05",
] as const;

const v = (metricId: string, period: string, value: string): MetricValue =>
  ({
    metricId,
    period: period as PeriodId,
    dims: {},
    value,
    nullReason: null,
    unit: "paise",
    formula: "",
    inputs: [],
  }) as unknown as MetricValue;

// Fourteen months, so a "last 12" and a financial year to date are different windows and a
// year-ago comparison has something to reach back to.
const store: MetricValue[] = MONTHS.flatMap((p, i) => [
  v("revenue", p, ((i + 1) * 100000).toString()),
  v("revenue.mom_pct", p, "5"),
  v("revenue.yoy_abs", p, "100000"),
  v("revenue.yoy_pct", p, "9"),
  v("revenue.mom_abs", p, "100000"),
]);

const format: ViewFormat = {
  money: (p) => `₹${p}`,
  decimal: (x) => x,
  axis: (n) => n.toString(),
  period: (p) => p,
  label: (m) => m,
};
const input = {
  period: "2026-05" as PeriodId,
  fyStartMonth: 4,
  format,
  dimensionFilter: null,
};
const widget = (over: Partial<Widget>): Widget => ({
  ...(DEFAULT_DASHBOARD.widgets[0] as Widget),
  metrics: ["revenue"],
  dimension: null,
  ...over,
});
const view = (w: Widget, lens: BoardLens = NO_LENS) =>
  buildWidgetView(w, store, { ...input, lens });
const columns = (w: Widget, lens: BoardLens): string[] =>
  (view(w, lens) as unknown as { columns: string[] }).columns;
const seriesNames = (w: Widget, lens: BoardLens): string[] => {
  const option = (view(w, lens) as { option: { legend?: { data: string[] } } }).option;
  return option.legend === undefined ? [] : [...option.legend.data];
};

const table = widget({ kind: "table", periods: { kind: "last_n", n: 3 } });
const card = widget({ kind: "kpi_card", periods: { kind: "current" } });
const line = widget({ kind: "line", periods: { kind: "last_n", n: 3 } });

describe("the board's lens", () => {
  it("leaves every box as it was saved when nothing is chosen", () => {
    expect(columns(table, NO_LENS)).toEqual(["2026-03", "2026-04", "2026-05"]);
  });

  it("retargets a box that shows several months", () => {
    expect(columns(table, { range: { kind: "last_n", n: 12 }, compare: null })).toEqual(
      MONTHS.slice(2),
    );
  });

  it("reads a financial year to its anchor, not to today", () => {
    // The company's year starts in April, and the anchor is May: two months, not fourteen.
    expect(columns(table, { range: { kind: "fy_to_date" }, compare: null })).toEqual([
      "2026-04",
      "2026-05",
    ]);
  });

  it("never widens a box that states one month", () => {
    // The whole reason the range is safe to apply to the whole board at once.
    const wide = view(card, { range: { kind: "last_n", n: 12 }, compare: null });
    expect(wide).toEqual(view(card, NO_LENS));
    expect((wide as unknown as { values: { display: string }[] }).values).toHaveLength(1);
  });

  it("can narrow every box to the anchor month", () => {
    expect(columns(table, { range: { kind: "current" }, compare: null })).toEqual([
      "2026-05",
    ]);
  });

  it("draws last year beside a trend when asked, and takes it away again", () => {
    expect(seriesNames(line, { range: null, compare: "last_year" })).toEqual([
      "revenue",
      "revenue, last year",
    ]);
    const saved = widget({
      kind: "line",
      periods: { kind: "last_n", n: 3 },
      compare: "last_year",
    });
    expect(seriesNames(saved, { range: null, compare: "none" })).toEqual([]);
  });

  it("moves a comparison box onto the basis the reader chose", () => {
    const box = widget({ kind: "comparison", compare: "previous_month" });
    const asked = view(box, { range: null, compare: "last_year" }) as unknown as {
      basis: string;
      rows: { change: { metricKey: string } }[];
    };
    expect(asked.basis).toBe("2025-05");
    expect(asked.rows[0]?.change.metricKey).toContain("revenue.yoy_abs");
  });

  it("asks for no month the company does not have", () => {
    // Twenty-four months back from the anchor reaches before the first file.
    expect(columns(table, { range: { kind: "last_n", n: 24 }, compare: null })).toEqual([
      ...MONTHS,
    ]);
  });
});
