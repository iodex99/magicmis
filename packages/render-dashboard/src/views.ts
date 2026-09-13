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
  readonly period: (period: string) => string;
  readonly label: (metricId: string) => string;
}

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
      return {
        kind: "chart",
        title: widget.title,
        option: {
          tooltip: { trigger: "axis" },
          xAxis: { type: "category", data: buckets.map((b) => b.dims["bucket"] ?? "") },
          yAxis: { type: "value" },
          series: [
            { type: "bar", name: input.format.label(metric), data: buckets.map(plotted) },
          ],
        },
        points: [buckets.map((b) => ref(metric, input.period, b.dims))],
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
      return {
        kind: "chart",
        title: widget.title,
        option: {
          tooltip: { trigger: "axis" },
          xAxis: { type: "category", data: labels },
          yAxis: { type: "value" },
          series: [
            {
              type: "bar",
              stack: "bridge",
              silent: true,
              itemStyle: { color: "transparent" },
              data: base,
            },
            { type: "bar", stack: "bridge", name: widget.title, data: bars },
          ],
        },
        points: [
          widget.metrics.map(() => ({ metricKey: "", display: "", unit: null })),
          widget.metrics.map((m) => ref(m, input.period)),
        ],
      };
    }

    case "line":
    case "bar":
    case "stacked_bar": {
      const type = widget.kind === "line" ? "line" : "bar";
      return {
        kind: "chart",
        title: widget.title,
        option: {
          tooltip: { trigger: "axis" },
          legend: { data: widget.metrics.map((m) => input.format.label(m)) },
          xAxis: { type: "category", data: periods.map((p) => input.format.period(p)) },
          yAxis: { type: "value" },
          series: widget.metrics.map((m) => ({
            type,
            name: input.format.label(m),
            ...(widget.kind === "stacked_bar" ? { stack: "total" } : {}),
            data: periods.map((p) => plotted(byKey.get(metricKey(m, p)))),
          })),
        },
        points: widget.metrics.map((m) => periods.map((p) => ref(m, p))),
      };
    }
  }
}
