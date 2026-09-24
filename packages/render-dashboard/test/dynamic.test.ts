/**
 * ADR 0046: the dashboard the chat builds. Comparison boxes, this year against last on a trend,
 * formulas as data — and the rule from ADR 0045 that none of it may make an older saved dashboard
 * unreadable.
 */

import type { PeriodId } from "@magicmis/core/time";
import type { MetricValue } from "@magicmis/engine";
import { describe, expect, it } from "vitest";

import { labelsFor } from "../src/format";
import { patchDashboard } from "../src/patch";
import {
  dashboardSpecSchema,
  DEFAULT_DASHBOARD,
  unknownMetrics,
  type Widget,
} from "../src/spec";
import { buildWidgetView, type ViewFormat } from "../src/views";

const v = (
  metricId: string,
  period: string,
  value: string | null,
  unit: MetricValue["unit"] = "paise",
): MetricValue =>
  ({
    metricId,
    period: period as PeriodId,
    dims: {},
    value,
    nullReason: value === null ? "no_prior_period" : null,
    unit,
    formula: "",
    inputs: [],
  }) satisfies MetricValue;

const format: ViewFormat = {
  money: (p) => `₹${p}p`,
  decimal: (x, unit) => `${x}${unit === "percent" ? "%" : ""}`,
  axis: (n) => `~${n.toString()}`,
  period: (p) => `P${p}`,
  label: (m) => m.toUpperCase(),
};
const input = {
  period: "2026-05" as PeriodId,
  fyStartMonth: 4,
  format,
  dimensionFilter: null,
};
const widget = (over: Partial<Widget>): Widget => ({
  ...(DEFAULT_DASHBOARD.widgets[0] as Widget),
  ...over,
});

describe("a saved dashboard from before ADR 0046", () => {
  it("still reads, and gains the new fields at their defaults", () => {
    // Exactly what was stored before: no `compare` on a widget, no `calculated` on the spec.
    const old = {
      schemaVersion: 1,
      grid: { columns: 12 },
      filters: { period: { default: "latest" }, dimension: null },
      widgets: [
        {
          id: "kpi_revenue",
          kind: "kpi_card",
          title: "Turnover",
          metrics: ["revenue", "revenue.mom_pct"],
          dimension: null,
          periods: { kind: "current" },
          layout: { x: 0, y: 0, w: 3, h: 2 },
          drilldown: { kind: "lineage" },
        },
      ],
    };
    const parsed = dashboardSpecSchema.safeParse(old);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.calculated).toEqual([]);
    expect(parsed.data?.widgets[0]).toMatchObject({ title: "Turnover", compare: "none" });
  });

  it("is not made unreadable by a metric the catalog no longer has", () => {
    const spec = {
      ...DEFAULT_DASHBOARD,
      widgets: [widget({ metrics: ["a_metric_since_removed"] })],
    };
    expect(dashboardSpecSchema.safeParse(spec).success).toBe(true);
    // It is reported where a change is proposed instead.
    expect(unknownMetrics(dashboardSpecSchema.parse(spec), new Set(["revenue"]))).toEqual(
      ["a_metric_since_removed"],
    );
  });
});

describe("a comparison box", () => {
  const store = [
    v("revenue", "2026-05", "1200000"),
    v("revenue", "2026-04", "1000000"),
    v("revenue", "2025-05", "1500000"),
    v("revenue.mom_abs", "2026-05", "200000"),
    v("revenue.mom_pct", "2026-05", "20.000000", "percent"),
    v("revenue.yoy_abs", "2026-05", "-300000"),
    v("revenue.yoy_pct", "2026-05", "-20.000000", "percent"),
    v("gross_margin_pct", "2026-05", "41.000000", "percent"),
    v("gross_margin_pct", "2026-04", "41.000000", "percent"),
    v("gross_margin_pct.mom_abs", "2026-05", "0.000000", "percent"),
    v("pat", "2026-05", "300000"),
    v("pat.mom_abs", "2026-05", null),
  ];

  it("sets each metric against last month: both figures, the change and the change %", () => {
    const view = buildWidgetView(
      widget({
        kind: "comparison",
        compare: "previous_month",
        metrics: ["revenue", "gross_margin_pct", "pat"],
      }),
      store,
      input,
    );
    if (view.kind !== "comparison") throw new Error(view.kind);
    expect([view.current, view.basis]).toEqual(["P2026-05", "P2026-04"]);
    expect(view.rows[0]).toEqual({
      label: "REVENUE",
      current: { metricKey: "revenue@2026-05", display: "₹1200000p", unit: "paise" },
      prior: { metricKey: "revenue@2026-04", display: "₹1000000p", unit: "paise" },
      change: {
        metricKey: "revenue.mom_abs@2026-05",
        display: "₹200000p",
        unit: "paise",
      },
      changePct: {
        metricKey: "revenue.mom_pct@2026-05",
        display: "20.000000%",
        unit: "percent",
      },
      direction: "up",
    });
    // A change in a percentage is in points: the store states no percent of it, so none is shown.
    expect(view.rows[1]).toMatchObject({ changePct: null, direction: "flat" });
    // No prior month: a dash and no arrow, never a zero.
    expect(view.rows[2]).toMatchObject({
      prior: { display: "—" },
      change: { display: "—" },
      direction: null,
    });
  });

  it("sets it against the same month last year when asked", () => {
    const view = buildWidgetView(
      widget({ kind: "comparison", compare: "last_year", metrics: ["revenue"] }),
      store,
      input,
    );
    if (view.kind !== "comparison") throw new Error(view.kind);
    expect(view.basis).toBe("P2025-05");
    expect(view.rows[0]).toMatchObject({
      prior: { metricKey: "revenue@2025-05" },
      change: { metricKey: "revenue.yoy_abs@2026-05" },
      direction: "down",
    });
  });
});

describe("a trend set against last year", () => {
  const store = [
    v("revenue", "2026-04", "1000000"),
    v("revenue", "2026-05", "1200000"),
    v("revenue", "2025-04", "800000"),
    v("revenue", "2025-05", "900000"),
  ];
  const trend = (over: Partial<Widget>) =>
    buildWidgetView(
      widget({
        kind: "line",
        metrics: ["revenue"],
        periods: { kind: "fy_to_date" },
        ...over,
      }),
      store,
      input,
    );

  it("adds the same months a year back as a second series on the same positions", () => {
    const view = trend({ compare: "last_year" });
    if (view.kind !== "chart") throw new Error(view.kind);
    const series = view.option.series as { name: string; data: number[] }[];
    expect(series.map((s) => s.name)).toEqual(["REVENUE", "REVENUE, last year"]);
    expect(series.map((s) => s.data)).toEqual([
      [10000, 12000],
      [8000, 9000],
    ]);
    // Each plotted point still opens its own month's lineage.
    expect(view.points[1]?.map((p) => p.metricKey)).toEqual([
      "revenue@2025-04",
      "revenue@2025-05",
    ]);
  });

  it("is one series without it, as before", () => {
    const view = trend({});
    if (view.kind !== "chart") throw new Error(view.kind);
    expect(view.option.series).toHaveLength(1);
  });
});

describe("formulas on a dashboard", () => {
  const share = {
    id: "calc_staff_share",
    label: "Staff cost share",
    unit: "percent",
    expr: {
      op: "mul",
      args: [
        { op: "div", args: [{ metric: "employee_cost" }, { metric: "revenue" }] },
        { const: "100" },
      ],
    },
  };
  // Everything the standard dashboard shows, which is what these patches start from.
  const catalog = new Set([
    "employee_cost",
    ...DEFAULT_DASHBOARD.widgets.flatMap((w) =>
      w.metrics.map((m) => m.split(".")[0] ?? m),
    ),
  ]);

  it("are added by a patch, and a box may then show them", () => {
    const r = patchDashboard(DEFAULT_DASHBOARD, [
      { op: "add", path: "/calculated/-", value: share },
      {
        op: "add",
        path: "/widgets/-",
        value: widget({
          id: "kpi_staff_share",
          title: "Staff cost share",
          metrics: ["calc_staff_share", "calc_staff_share.mom_abs"],
          layout: { x: 0, y: 10, w: 3, h: 2 },
        }),
      },
    ]);
    if (!r.ok) throw new Error(r.errors.join("; "));
    expect(r.spec.calculated).toHaveLength(1);
    expect(unknownMetrics(r.spec, catalog)).toEqual([]);
    expect(labelsFor(r.spec.calculated)("calc_staff_share")).toBe("Staff cost share");
    expect(labelsFor(r.spec.calculated)("calc_staff_share.mom_abs")).toBe(
      "Staff cost share, change on last month",
    );
    expect(labelsFor(r.spec.calculated)("revenue")).toBe("Revenue from operations");
  });

  it("cannot be shown without a formula, defined twice, or removed from under a box", () => {
    const orphan = patchDashboard(DEFAULT_DASHBOARD, [
      { op: "replace", path: "/widgets/0/metrics", value: ["calc_nowhere"] },
    ]);
    expect(orphan).toMatchObject({ ok: false });
    const twice = patchDashboard(DEFAULT_DASHBOARD, [
      { op: "add", path: "/calculated/-", value: share },
      { op: "add", path: "/calculated/-", value: share },
    ]);
    expect(twice).toMatchObject({ ok: false });
    const made = patchDashboard(DEFAULT_DASHBOARD, [
      { op: "add", path: "/calculated/-", value: share },
      { op: "replace", path: "/widgets/0/metrics", value: ["calc_staff_share"] },
    ]);
    if (!made.ok) throw new Error(made.errors.join("; "));
    expect(
      patchDashboard(made.spec, [{ op: "remove", path: "/calculated/0" }]),
    ).toMatchObject({ ok: false });
  });

  it("report a metric nothing will compute, in a box or inside a formula", () => {
    const r = patchDashboard(DEFAULT_DASHBOARD, [
      {
        op: "add",
        path: "/calculated/-",
        value: { ...share, expr: { metric: "headcount" } },
      },
      {
        op: "replace",
        path: "/widgets/0/metrics",
        value: ["revenue.weekly", "calc_staff_share.ytd"],
      },
    ]);
    if (!r.ok) throw new Error(r.errors.join("; "));
    expect(unknownMetrics(r.spec, catalog).sort()).toEqual(
      ["calc_staff_share.ytd", "headcount", "revenue.weekly"].sort(),
    );
  });
});

/*
 * ADR 0056 follow-up. A box whose drilldown is absent or null is a box that drills to its own
 * lineage, which is what Investigate does on every box anyway (ADR 0047).
 *
 * This was found by the first live eval of `dashboard_layout`: the efficient tier wrote
 * `"drilldown": null` on three hundred and forty-three of its four hundred and thirty-two boxes
 * and scored 0.298, while the two larger models never once did it. The field was the only one of
 * its group — `compare`, `sort`, `limit` all sit beside it with defaults — that a producer had to
 * state. Refusing a whole board over the one value it could have inferred is the schema's fault,
 * not the producer's.
 */
describe("a box that does not say where it drills to", () => {
  const box = {
    id: "w1",
    kind: "kpi_card",
    title: "Revenue",
    metrics: ["revenue"],
    dimension: null,
    periods: { kind: "current" },
    layout: { x: 0, y: 0, w: 3, h: 2 },
  };
  const specWith = (drilldown: unknown) =>
    dashboardSpecSchema.safeParse({
      schemaVersion: 1,
      grid: { columns: 12 },
      filters: { period: { default: "latest" }, dimension: null },
      widgets: [drilldown === undefined ? box : { ...box, drilldown }],
      calculated: [],
    });

  it("reads null as lineage", () => {
    const r = specWith(null);
    expect(r.success).toBe(true);
    expect(r.success && r.data.widgets[0]?.drilldown).toEqual({ kind: "lineage" });
  });

  it("reads a missing drilldown as lineage", () => {
    const r = specWith(undefined);
    expect(r.success).toBe(true);
    expect(r.success && r.data.widgets[0]?.drilldown).toEqual({ kind: "lineage" });
  });

  it("still keeps a drilldown that was stated", () => {
    const r = specWith({ kind: "widget", widgetId: "w1" });
    expect(r.success && r.data.widgets[0]?.drilldown).toEqual({
      kind: "widget",
      widgetId: "w1",
    });
  });

  it("still refuses a drilldown that is neither", () => {
    expect(specWith({ kind: "elsewhere" }).success).toBe(false);
  });
});

/*
 * ADR 0066, second instance. `dimension` had the same wart as `drilldown`: nullable but still
 * required, so a box with nothing to split by had to say so or take the whole board down with
 * it. Absent and null both mean "show the total".
 */
describe("a box that does not say what it splits by", () => {
  const parse = (dimension: unknown, omit = false) =>
    dashboardSpecSchema.safeParse({
      schemaVersion: 1,
      grid: { columns: 12 },
      filters: { period: { default: "latest" }, dimension: null },
      widgets: [
        {
          id: "w1",
          kind: "kpi_card",
          title: "Revenue",
          metrics: ["revenue"],
          ...(omit ? {} : { dimension }),
          periods: { kind: "current" },
          layout: { x: 0, y: 0, w: 3, h: 2 },
          drilldown: { kind: "lineage" },
        },
      ],
      calculated: [],
    });

  it("reads a missing dimension as no split", () => {
    const r = parse(undefined, true);
    expect(r.success).toBe(true);
    expect(r.success && r.data.widgets[0]?.dimension).toBeNull();
  });

  it("still keeps a dimension that was stated", () => {
    const r = parse("party");
    expect(r.success && r.data.widgets[0]?.dimension).toBe("party");
  });

  it("still refuses a dimension that is not a valid name", () => {
    expect(parse("Party Name!").success).toBe(false);
  });
});
