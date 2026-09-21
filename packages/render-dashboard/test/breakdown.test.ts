/**
 * A box split by a dimension, ordered and trimmed (ADR 0056).
 *
 * The engine has always worked out payroll by designation every month and there was no box that
 * could show it. Now there is, and with many rows the order and the cut-off are the whole point:
 * a person wants the largest few, not thirty rows alphabetically.
 */

import type { PeriodId } from "@magicmis/core/time";
import type { MetricValue } from "@magicmis/engine";
import { describe, expect, it } from "vitest";

import { DEFAULT_DASHBOARD, dashboardSpecSchema, type Widget } from "../src/spec";
import { buildWidgetView, type ViewFormat } from "../src/views";

const v = (
  metricId: string,
  value: string | null,
  dims: Record<string, string> = {},
): MetricValue =>
  ({
    metricId,
    period: "2026-05" as PeriodId,
    dims,
    value,
    nullReason: value === null ? "no_data" : null,
    unit: "paise",
    formula: "",
    inputs: [],
  }) as unknown as MetricValue;

// Deliberately not in value order, and one of them larger than a double can hold exactly.
const store: MetricValue[] = [
  v("payroll_cost", "300000", { designation: "Analyst" }),
  v("payroll_cost", "900000", { designation: "Director" }),
  v("payroll_cost", "100000", { designation: "Intern" }),
  v("payroll_cost", "9007199254740993", { designation: "Founder" }),
  v("receivables_ageing", "10000", { bucket: "31-60" }),
  v("receivables_ageing", "90000", { bucket: "0-30" }),
];

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
  kind: "breakdown",
  metrics: ["payroll_cost"],
  dimension: "designation",
  ...over,
});
const labels = (view: unknown): string[] => [
  ...(view as { option: { xAxis: { data: string[] } } }).option.xAxis.data,
];

describe("a box split by a dimension", () => {
  it("leaves the engine's own order alone when nothing is asked for", () => {
    const view = buildWidgetView(widget({}), store, input);
    expect(labels(view)).toEqual(["Analyst", "Director", "Intern", "Founder"]);
  });

  it("orders by value, largest first, without going through a float", () => {
    const view = buildWidgetView(
      widget({ sort: { by: "value", direction: "desc" } }),
      store,
      input,
    );
    // The founder's figure is larger than Number.MAX_SAFE_INTEGER; comparing as numbers would
    // make it tie with its neighbour and the order would depend on the sort's stability.
    expect(labels(view)).toEqual(["Founder", "Director", "Analyst", "Intern"]);
  });

  it("orders by label and by value ascending", () => {
    expect(
      labels(
        buildWidgetView(
          widget({ sort: { by: "label", direction: "asc" } }),
          store,
          input,
        ),
      ),
    ).toEqual(["Analyst", "Director", "Founder", "Intern"]);
    expect(
      labels(
        buildWidgetView(
          widget({ sort: { by: "value", direction: "asc" } }),
          store,
          input,
        ),
      ),
    ).toEqual(["Intern", "Analyst", "Director", "Founder"]);
  });

  it("keeps only the top rows when a limit is set", () => {
    const view = buildWidgetView(
      widget({ sort: { by: "value", direction: "desc" }, limit: 2 }),
      store,
      input,
    );
    expect(labels(view)).toEqual(["Founder", "Director"]);
  });

  it("says so rather than drawing nothing when the split is empty or unnamed", () => {
    expect(
      buildWidgetView(widget({ dimension: "department" }), store, input),
    ).toMatchObject({
      kind: "empty",
    });
    expect(buildWidgetView(widget({ dimension: null }), store, input)).toMatchObject({
      kind: "empty",
    });
  });

  it("leaves an ageing chart in bucket order unless it is asked otherwise", () => {
    const ageing = widget({
      kind: "ageing_chart",
      metrics: ["receivables_ageing"],
      dimension: null,
    });
    expect(labels(buildWidgetView(ageing, store, input))).toEqual(["31-60", "0-30"]);
    expect(
      labels(
        buildWidgetView(
          { ...ageing, sort: { by: "label", direction: "asc" } },
          store,
          input,
        ),
      ),
    ).toEqual(["0-30", "31-60"]);
  });

  it("reads a dashboard saved before sorting existed (ADR 0045)", () => {
    // Every addition to the spec is optional with a default, or a company's own saved board
    // would stop parsing the day the schema moved.
    const old = JSON.parse(JSON.stringify(DEFAULT_DASHBOARD)) as {
      widgets: Record<string, unknown>[];
    };
    for (const w of old.widgets) {
      delete w["sort"];
      delete w["limit"];
    }
    const parsed = dashboardSpecSchema.parse(old);
    expect(parsed.widgets[0]?.sort).toBeNull();
    expect(parsed.widgets[0]?.limit).toBeNull();
  });
});
