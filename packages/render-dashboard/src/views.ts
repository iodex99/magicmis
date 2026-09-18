/**
 * Widget views (SPEC §24.2): pure functions from spec + metric store to what the browser draws.
 * Charts get an ECharts option; every plotted point and every KPI value carries the metric key its
 * lineage panel opens. Display numbers come from the store's exact strings; the chart's numeric
 * copy is for drawing only.
 */

import type { PeriodId } from "@magicmis/core/time";
import { addMonths, financialYearOf, periodRange } from "@magicmis/core/time";
import type { MetricValue } from "@magicmis/engine";
import type { EChartsOption } from "echarts";

import type { Widget } from "./spec";

export interface ValueRef {
  readonly metricKey: string;
  readonly display: string;
  readonly unit: MetricValue["unit"] | null;
}

export type WidgetView =
  | { readonly kind: "kpi"; readonly title: string; readonly values: readonly ValueRef[] }
  | {
      readonly kind: "chart";
      readonly title: string;
      readonly option: EChartsOption;
      readonly points: readonly (readonly ValueRef[])[];
    }
  | {
      readonly kind: "table";
      readonly title: string;
      readonly columns: readonly string[];
      readonly rows: readonly { label: string; cells: readonly ValueRef[] }[];
    }
  | { readonly kind: "empty"; readonly title: string; readonly reason: string };

export interface ViewFormat {
  readonly money: (paise: string) => string;
  readonly decimal: (value: string, unit: MetricValue["unit"]) => string;
  /** A chart axis label in the company's own currency, shortened (ADR 0034). */
  readonly axis: (value: number) => string;
  readonly period: (period: string) => string;
  readonly label: (metricId: string) => string;
}

/**
 * Chart styling (SPEC §32): the one accent plus neutrals that stay apart under the common
 * forms of colour vision deficiency, axes drawn as faint rules rather than boxes, and no
 * decoration. Kept here so every chart in the product looks like the same chart.
 */
const PALETTE = ["#5846d2", "#15724a", "#8a5300", "#6f6c85", "#ab9ef5", "#b03024"];
const AXIS_TEXT = "#6f6c85";
const GRID_LINE = "#eceaf3";

interface TooltipParam {
  readonly marker?: string;
  readonly seriesName?: string;
  readonly seriesIndex?: number;
  readonly dataIndex?: number;
  readonly axisValueLabel?: string;
}

/**
 * The tooltip reads the exact strings shown everywhere else for those points, so hovering
 * a line can never disagree with the card, the table or the workbook.
 */
function tooltipFrom(
  points: readonly (readonly ValueRef[])[],
  heading?: (index: number) => string,
): NonNullable<EChartsOption["tooltip"]> {
  return {
    trigger: "axis",
    borderWidth: 0,
    textStyle: { fontSize: 12 },
    formatter: (raw: unknown) => {
      const list = (Array.isArray(raw) ? raw : [raw]) as TooltipParam[];
      const first = list[0];
      if (first === undefined) return "";
      const head = heading?.(first.dataIndex ?? 0) ?? first.axisValueLabel ?? "";
      const rows = list
        .map((p) => {
          const ref = points[p.seriesIndex ?? 0]?.[p.dataIndex ?? 0];
          if (ref === undefined || ref.metricKey === "") return null;
          return `${p.marker ?? ""} ${p.seriesName ?? ""} <b>${ref.display}</b>`;
        })
        .filter((r): r is string => r !== null);
      return rows.length === 0 ? "" : [head, ...rows].join("<br/>");
    },
  };
}

/** Axes, grid and legend, identical for every chart kind. */
function frame(format: ViewFormat, money: boolean): EChartsOption {
  return {
    color: PALETTE,
    // A chart draws itself in rather than appearing (ADR 0036); the option is data, and the
    // browser honours reduced-motion by drawing at once.
    animationDuration: 900,
    animationEasing: "cubicOut",
    grid: { left: 4, right: 12, top: 12, bottom: 4, containLabel: true },
    textStyle: { fontFamily: "inherit" },
    yAxis: {
      type: "value",
      axisLabel: {
        color: AXIS_TEXT,
        fontSize: 11,
        ...(money ? { formatter: (v: number) => format.axis(v) } : {}),
      },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: GRID_LINE } },
    },
  };
}

const categoryAxis = (data: readonly string[]): NonNullable<EChartsOption["xAxis"]> => ({
  type: "category",
  data: [...data],
  axisLabel: { color: AXIS_TEXT, fontSize: 11 },
  axisLine: { lineStyle: { color: GRID_LINE } },
  axisTick: { show: false },
});

const legendFor = (names: readonly string[]): NonNullable<EChartsOption["legend"]> => ({
  data: [...names],
  bottom: 0,
  icon: "roundRect",
  itemWidth: 9,
  itemHeight: 9,
  itemGap: 14,
  textStyle: { color: AXIS_TEXT, fontSize: 11 },
});

export const metricKey = (
  metricId: string,
  period: string,
  dims: Readonly<Record<string, string>> = {},
): string =>
  `${metricId}@${period}${Object.keys(dims)
    .sort()
    .map((k) => `|${k}=${dims[k] ?? ""}`)
    .join("")}`;

function periodsFor(
  widget: Widget,
  period: PeriodId,
  fyStartMonth: number,
  available: ReadonlySet<string>,
): PeriodId[] {
  const list =
    widget.periods.kind === "current"
      ? [period]
      : widget.periods.kind === "fy_to_date"
        ? periodRange(financialYearOf(period, fyStartMonth).start, period)
        : periodRange(addMonths(period, 1 - widget.periods.n), period);
  return list.filter((p) => available.has(p));
}

// Chart values only: never used for a displayed figure.
const plotted = (v: MetricValue | undefined): number | null => {
  if (v?.value == null) return null;
  const n = Number.parseFloat(v.value);
  return v.unit === "paise" ? n / 100 : n;
};

export function buildWidgetView(
  widget: Widget,
  store: readonly MetricValue[],
  input: {
    period: PeriodId;
    fyStartMonth: number;
    format: ViewFormat;
    dimensionFilter: string | null;
  },
): WidgetView {
  const byKey = new Map(store.map((v) => [metricKey(v.metricId, v.period, v.dims), v]));
  const available = new Set(store.map((v) => v.period));
  const ref = (
    metricId: string,
    period: string,
    dims: Record<string, string> = {},
  ): ValueRef => {
    const key = metricKey(metricId, period, dims);
    const v = byKey.get(key);
    const display =
      v === undefined || v.value === null
        ? "—"
        : v.unit === "paise"
          ? input.format.money(v.value)
          : input.format.decimal(v.value, v.unit);
    return { metricKey: key, display, unit: v?.unit ?? null };
  };
  const periods = periodsFor(widget, input.period, input.fyStartMonth, available);
  if (periods.length === 0)
    return { kind: "empty", title: widget.title, reason: "No data for these months." };

  switch (widget.kind) {
    case "kpi_card":
      return {
        kind: "kpi",
        title: widget.title,
        values: widget.metrics.map((m) => ref(m, input.period)),
      };

    case "table":
      return {
        kind: "table",
        title: widget.title,
        columns: periods.map((p) => input.format.period(p)),
        rows: widget.metrics.map((m) => ({
          label: input.format.label(m),
          cells: periods.map((p) => ref(m, p)),
        })),
      };

    case "ageing_chart": {
      const metric = widget.metrics[0] ?? "receivables_ageing";
      const buckets = store.filter(
        (v) =>
          v.metricId === metric &&
          v.period === input.period &&
          v.dims["bucket"] !== undefined,
      );
      if (buckets.length === 0)
        return {
          kind: "empty",
          title: widget.title,
          reason: "No bills were loaded for this month.",
        };
      const points = [buckets.map((b) => ref(metric, input.period, b.dims))];
      return {
        kind: "chart",
        title: widget.title,
        option: {
          ...frame(input.format, buckets[0]?.unit === "paise"),
          tooltip: tooltipFrom(points),
          xAxis: categoryAxis(buckets.map((b) => b.dims["bucket"] ?? "")),
          series: [
            {
              type: "bar",
              name: input.format.label(metric),
              barMaxWidth: 36,
              itemStyle: { borderRadius: [3, 3, 0, 0] },
              data: buckets.map(plotted),
            },
          ],
        },
        points,
      };
    }

    case "waterfall": {
      // Revenue, then each cost as a drop, then the result: an invisible base series under the steps.
      const [first, ...rest] = widget.metrics;
      const result = rest.at(-1);
      const steps = rest.slice(0, -1);
      if (first === undefined || result === undefined)
        return {
          kind: "empty",
          title: widget.title,
          reason: "The bridge needs a start and a result.",
        };
      const start = plotted(byKey.get(metricKey(first, input.period)));
      if (start === null)
        return { kind: "empty", title: widget.title, reason: "No data for this month." };
      const base: (number | null)[] = [0];
      const bars: (number | null)[] = [start];
      let running = start;
      for (const s of steps) {
        const drop = plotted(byKey.get(metricKey(s, input.period))) ?? 0;
        running -= drop;
        base.push(Math.min(running, running + drop));
        bars.push(Math.abs(drop));
      }
      base.push(0);
      bars.push(plotted(byKey.get(metricKey(result, input.period))));
      const labels = widget.metrics.map((m) => input.format.label(m));
      const points = [
        widget.metrics.map(() => ({ metricKey: "", display: "", unit: null })),
        widget.metrics.map((m) => ref(m, input.period)),
      ];
      return {
        kind: "chart",
        title: widget.title,
        option: {
          ...frame(input.format, true),
          // Each bar is one step of the bridge, so the tooltip names the step, not the axis.
          tooltip: tooltipFrom(points, (i) => labels[i] ?? ""),
          xAxis: categoryAxis(labels),
          series: [
            {
              type: "bar",
              stack: "bridge",
              silent: true,
              itemStyle: { color: "transparent" },
              data: base,
            },
            {
              type: "bar",
              stack: "bridge",
              name: widget.title,
              barMaxWidth: 44,
              data: bars,
            },
          ],
        },
        points,
      };
    }

    case "line":
    case "bar":
    case "stacked_bar": {
      const type = widget.kind === "line" ? "line" : "bar";
      const names = widget.metrics.map((m) => input.format.label(m));
      const points = widget.metrics.map((m) => periods.map((p) => ref(m, p)));
      const money = widget.metrics.some((m) =>
        periods.some((p) => byKey.get(metricKey(m, p))?.unit === "paise"),
      );
      return {
        kind: "chart",
        title: widget.title,
        option: {
          ...frame(input.format, money),
          tooltip: tooltipFrom(points),
          ...(names.length > 1 ? { legend: legendFor(names) } : {}),
          grid: {
            left: 4,
            right: 12,
            top: 12,
            bottom: names.length > 1 ? 26 : 4,
            containLabel: true,
          },
          xAxis: categoryAxis(periods.map((p) => input.format.period(p))),
          series: widget.metrics.map((m, i) => ({
            type,
            name: names[i] ?? "",
            ...(widget.kind === "stacked_bar" ? { stack: "total" } : {}),
            ...(type === "line"
              ? { smooth: false, symbolSize: 6, lineStyle: { width: 2 } }
              : { barMaxWidth: 28, itemStyle: { borderRadius: [3, 3, 0, 0] } }),
            data: periods.map((p) => plotted(byKey.get(metricKey(m, p)))),
          })),
        },
        points,
      };
    }
  }
}
