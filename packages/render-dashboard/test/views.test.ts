import type { PeriodId } from "@magicmis/core/time";
import type { CommentaryOutput, MetricValue } from "@magicmis/engine";
import { describe, expect, it } from "vitest";

import { renderCommentary } from "../src/commentary";
import { DEFAULT_DASHBOARD, type Widget } from "../src/spec";
import { buildWidgetView, metricKey, type ViewFormat } from "../src/views";

const v = (
  metricId: string,
  period: string,
  value: string | null,
  unit: MetricValue["unit"] = "paise",
  dims: Record<string, string> = {},
): MetricValue =>
  ({
    metricId,
    period: period as PeriodId,
    dims,
    value,
    nullReason: value === null ? "no_data" : null,
    unit,
    formula: "",
    inputs: [],
  }) as unknown as MetricValue;

const store: MetricValue[] = [
  v("revenue", "2026-04", "1000000"),
  v("revenue", "2026-05", "1200000"),
  v("revenue.mom_pct", "2026-05", "20.000000", "percent"),
  v("gross_profit", "2026-04", "400000"),
  v("gross_profit", "2026-05", "500000"),
  v("pat", "2026-05", "300000"),
  v("direct_costs", "2026-05", "700000"),
  v("other_opex", "2026-05", "200000"),
  v("receivables_ageing", "2026-05", "90000", "paise", { bucket: "0-30" }),
  v("receivables_ageing", "2026-05", "10000", "paise", { bucket: "31-60" }),
];

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

describe("buildWidgetView", () => {
  it("KPI values display the store's exact strings with lineage keys", () => {
    const view = buildWidgetView(
      widget({ metrics: ["revenue", "revenue.mom_pct", "ebitda"] }),
      store,
      input,
    );
    expect(view).toEqual({
      kind: "kpi",
      title: "Revenue",
      values: [
        { metricKey: "revenue@2026-05", display: "₹1200000p", unit: "paise" },
        { metricKey: "revenue.mom_pct@2026-05", display: "20.000000%", unit: "percent" },
        { metricKey: "ebitda@2026-05", display: "—", unit: null },
      ],
    });
  });

  it("year-to-date line charts plot every loaded month with a lineage point per value", () => {
    const view = buildWidgetView(
      widget({
        kind: "line",
        metrics: ["revenue", "gross_profit"],
        periods: { kind: "fy_to_date" },
      }),
      store,
      input,
    );
    if (view.kind !== "chart") throw new Error(view.kind);
    expect(view.option.xAxis).toMatchObject({ data: ["P2026-04", "P2026-05"] });
    expect(view.option.series).toMatchObject([
      { type: "line", name: "REVENUE", data: [10000, 12000] },
      { type: "line", name: "GROSS_PROFIT", data: [4000, 5000] },
    ]);
    expect(view.points[1]?.[0]?.metricKey).toBe("gross_profit@2026-04");
  });

  it("stacked bars stack; tables show a column per period", () => {
    const bars = buildWidgetView(
      widget({
        kind: "stacked_bar",
        metrics: ["revenue"],
        periods: { kind: "last_n", n: 3 },
      }),
      store,
      input,
    );
    expect(bars.kind === "chart" && bars.option.series).toMatchObject([
      { type: "bar", stack: "total" },
    ]);
    const table = buildWidgetView(
      widget({ kind: "table", metrics: ["revenue"], periods: { kind: "last_n", n: 2 } }),
      store,
      input,
    );
    expect(table).toMatchObject({
      kind: "table",
      columns: ["P2026-04", "P2026-05"],
      rows: [
        { label: "REVENUE", cells: [{ display: "₹1000000p" }, { display: "₹1200000p" }] },
      ],
    });
  });

  it("waterfall steps down from revenue to the result", () => {
    const view = buildWidgetView(
      widget({
        kind: "waterfall",
        metrics: ["revenue", "direct_costs", "other_opex", "pat"],
      }),
      store,
      input,
    );
    if (view.kind !== "chart") throw new Error(view.kind);
    expect(view.option.series).toMatchObject([
      { data: [0, 5000, 3000, 0] },
      { data: [12000, 7000, 2000, 3000] },
    ]);
  });

  it("ageing charts read bucket dimensions; missing data gives an empty view", () => {
    const view = buildWidgetView(
      widget({ kind: "ageing_chart", metrics: ["receivables_ageing"] }),
      store,
      input,
    );
    expect(view.kind === "chart" && view.points[0]?.map((p) => p.metricKey)).toEqual([
      "receivables_ageing@2026-05|bucket=0-30",
      "receivables_ageing@2026-05|bucket=31-60",
    ]);
    expect(
      buildWidgetView(widget({}), store, { ...input, period: "2025-01" as PeriodId })
        .kind,
    ).toBe("empty");
  });

  it("metric keys sort dimensions", () => {
    expect(metricKey("x", "2026-05", { z: "1", a: "2" })).toBe("x@2026-05|a=2|z=1");
  });
});

describe("renderCommentary", () => {
  const pack = {
    facts: [
      { id: "m:revenue@2026-05", label: "Revenue", text: "" },
      { id: "mv:revenue.mom@2026-05:pct", label: "Revenue change", text: "" },
    ],
    dimensions: [{ id: "d:PARTY_9f3a1c2e", label: "party" }],
    periods: ["p:2026-05"],
  } as unknown as Parameters<typeof renderCommentary>[1];
  const cformat = {
    ...format,
    name: (t: string) => (t === "PARTY_9f3a1c2e" ? "Asha Traders" : null),
  };

  it("substitutes placeholders with values and lineage keys", () => {
    const output: CommentaryOutput = {
      sections: [
        {
          heading: "Sales in {{p:2026-05}}",
          paragraphs: [
            {
              text: "Revenue was {{m:revenue@2026-05}} ({{mv:revenue.mom@2026-05:pct}}), led by {{d:PARTY_9f3a1c2e}}.",
            },
          ],
        },
      ],
    };
    const r = renderCommentary(output, pack, store, [], cformat);
    if (!r.ok) throw new Error(r.problems.join("; "));
    expect(r.commentary.sections[0]?.heading).toEqual([
      { kind: "text", text: "Sales in " },
      { kind: "value", display: "P2026-05", metricKey: null, hint: null },
    ]);
    expect(r.commentary.sections[0]?.paragraphs[0]).toEqual([
      { kind: "text", text: "Revenue was " },
      { kind: "value", display: "₹1200000p", metricKey: "revenue@2026-05", hint: null },
      { kind: "text", text: " (" },
      {
        kind: "value",
        display: "20.000000%",
        metricKey: "revenue.mom_pct@2026-05",
        hint: null,
      },
      { kind: "text", text: "), led by " },
      { kind: "value", display: "Asha Traders", metricKey: null, hint: null },
      { kind: "text", text: "." },
    ]);
  });

  it("re-runs the post-check in the browser and refuses injected numerals", () => {
    const r = renderCommentary(
      { sections: [{ heading: "H", paragraphs: [{ text: "Revenue rose 12%." }] }] },
      pack,
      store,
      [],
      cformat,
    );
    expect(r.ok).toBe(false);
  });
});
