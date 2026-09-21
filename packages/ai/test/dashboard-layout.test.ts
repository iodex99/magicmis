/**
 * The checks on a dashboard Claude chose (ADR 0056).
 *
 * The model picks which boxes a company opens with. What it must never do is put a figure into
 * the board, or a box onto it for a figure that company will never have. These are the checks
 * that hold it to that, and they run before anything is stored.
 */

import { describe, expect, it } from "vitest";

import { specFromLayout, type DashboardLayoutInput } from "../src/dashboard-layout";

const input: DashboardLayoutInput = {
  metrics: [
    { id: "revenue", unit: "paise", label: "Revenue" },
    { id: "gross_profit", unit: "paise", label: "Gross profit" },
    { id: "inventory", unit: "paise", label: "Inventory" },
    { id: "payroll_cost", unit: "paise", label: "Payroll cost" },
  ],
  // This company has no inventory: a services business.
  present: ["revenue", "gross_profit", "payroll_cost"],
  dimensioned: [
    {
      metricId: "payroll_cost",
      dimension: "designation",
      valueCount: 2,
    },
  ],
  months: 14,
};

const box = (over: Record<string, unknown>) => ({
  id: "b1",
  kind: "kpi_card",
  title: "Revenue",
  metrics: ["revenue"],
  dimension: null,
  periods: { kind: "current" },
  layout: { x: 0, y: 0, w: 3, h: 2 },
  drilldown: { kind: "lineage" },
  compare: "none",
  sort: null,
  limit: null,
  ...over,
});
const out = (
  widgets: unknown[],
  summary = "Revenue and payroll, as a services business reads.",
) => ({
  summary,
  widgets_json: JSON.stringify(widgets),
  calculated_json: null,
});

describe("a dashboard chosen for a company", () => {
  it("accepts a layout built only from figures that company holds", () => {
    const r = specFromLayout(
      input,
      out([
        box({}),
        box({
          id: "pay",
          kind: "breakdown",
          title: "Payroll by designation",
          metrics: ["payroll_cost"],
          dimension: "designation",
          layout: { x: 0, y: 2, w: 6, h: 4 },
          sort: { by: "value", direction: "desc" },
          limit: 10,
        }),
      ]),
    );
    expect(r.ok, r.ok ? "" : r.problems.join("; ")).toBe(true);
    if (!r.ok) return;
    expect(r.spec.widgets).toHaveLength(2);
    expect(r.spec.widgets[1]?.limit).toBe(10);
  });

  it("refuses a box for a figure this company will never have", () => {
    // Inventory is in the catalog but not in these books. A box for it would show a dash every
    // month and teach the customer to distrust the board.
    const r = specFromLayout(
      input,
      out([box({ metrics: ["inventory"], title: "Stock" })]),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(" ")).toContain("no figures for inventory");
  });

  it("refuses a digit anywhere in a title or the summary (locked decision 7)", () => {
    // There is no request here that could have typed a number, so any digit is the model's own.
    // "Top ten" is the limit field, never words.
    const titled = specFromLayout(input, out([box({ title: "Top 10 earners" })]));
    expect(titled.ok).toBe(false);
    if (!titled.ok)
      expect(titled.problems.join(" ")).toContain("must not contain digits");

    const summed = specFromLayout(
      input,
      out([box({})], "Shows the 4 figures that matter most."),
    );
    expect(summed.ok).toBe(false);
  });

  it("refuses a breakdown by a split the books do not make", () => {
    const r = specFromLayout(
      input,
      out([
        box({
          kind: "breakdown",
          metrics: ["payroll_cost"],
          dimension: "department",
          title: "Payroll by department",
        }),
      ]),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(" ")).toContain("not split by department");
  });

  it("refuses an empty board, bad JSON and a spec the schema rejects", () => {
    expect(specFromLayout(input, out([])).ok).toBe(false);
    expect(
      specFromLayout(input, {
        summary: "A board.",
        widgets_json: "{[",
        calculated_json: null,
      }).ok,
    ).toBe(false);
    // Past the twelve-column grid.
    expect(
      specFromLayout(input, out([box({ layout: { x: 8, y: 0, w: 6, h: 2 } })])).ok,
    ).toBe(false);
  });
});
