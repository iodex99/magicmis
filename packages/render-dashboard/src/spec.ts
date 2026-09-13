/**
 * Dashboard spec (SPEC §24.2): data, not code. A grid of widgets bound to metric IDs, dimensions
 * and periods; global period and dimension filters; drilldown to another widget or the lineage
 * panel. Renderers read only this spec and the metric store; nothing generated is executed.
 */

import { z } from "zod";

const id = z.string().regex(/^[a-z0-9_]{1,40}$/u);
const metricId = z.string().regex(/^[a-z_]{1,60}(\.[a-z_]{1,20})?$/u);

export const WIDGET_KINDS = [
  "kpi_card",
  "line",
  "bar",
  "stacked_bar",
  "waterfall",
  "table",
  "ageing_chart",
] as const;

export const widgetSchema = z
  .object({
    id,
    kind: z.enum(WIDGET_KINDS),
    title: z.string().min(1).max(80),
    metrics: z.array(metricId).min(1).max(8),
    /** Dimension to split by (e.g. `party`, `bucket`); null for totals. */
    dimension: z
      .string()
      .regex(/^[a-z_]{1,30}$/u)
      .nullable(),
    /** Periods shown: the filter period only, or the financial year to date, or the last N months. */
    periods: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("current") }),
      z.object({ kind: z.literal("fy_to_date") }),
      z.object({ kind: z.literal("last_n"), n: z.number().int().min(2).max(24) }),
    ]),
    layout: z.object({
      x: z.number().int().min(0).max(11),
      y: z.number().int().min(0).max(200),
      w: z.number().int().min(1).max(12),
      h: z.number().int().min(1).max(12),
    }),
    drilldown: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("lineage") }),
      z.object({ kind: z.literal("widget"), widgetId: id }),
    ]),
  })
  .strict()
  .refine((w) => w.layout.x + w.layout.w <= 12, {
    message: "widget extends past the grid",
  });
export type Widget = z.infer<typeof widgetSchema>;

export const dashboardSpecSchema = z
  .object({
    schemaVersion: z.literal(1),
    grid: z.object({ columns: z.literal(12) }).strict(),
    filters: z
      .object({
        period: z.object({ default: z.literal("latest") }).strict(),
        dimension: z
          .object({
            id: z.string().regex(/^[a-z_]{1,30}$/u),
            values: z.array(z.string().max(80)).max(50),
          })
          .strict()
          .nullable(),
      })
      .strict(),
    widgets: z.array(widgetSchema).max(40),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const ids = new Set<string>();
    for (const w of spec.widgets) {
      if (ids.has(w.id))
        ctx.addIssue({ code: "custom", message: `duplicate widget id ${w.id}` });
      ids.add(w.id);
    }
    for (const w of spec.widgets) {
      if (w.drilldown.kind === "widget" && !ids.has(w.drilldown.widgetId)) {
        ctx.addIssue({
          code: "custom",
          message: `widget ${w.id} drills down to missing widget ${w.drilldown.widgetId}`,
        });
      }
    }
  });
export type DashboardSpec = z.infer<typeof dashboardSpecSchema>;

const w = (
  wid: string,
  kind: Widget["kind"],
  title: string,
  metrics: string[],
  layout: Widget["layout"],
  periods: Widget["periods"] = { kind: "current" },
): Widget => ({
  id: wid,
  kind,
  title,
  metrics,
  dimension: null,
  periods,
  layout,
  drilldown: { kind: "lineage" },
});

/** Default dashboard for the Monthly Financial MIS template. */
export const DEFAULT_DASHBOARD: DashboardSpec = dashboardSpecSchema.parse({
  schemaVersion: 1,
  grid: { columns: 12 },
  filters: { period: { default: "latest" }, dimension: null },
  widgets: [
    w("kpi_revenue", "kpi_card", "Revenue", ["revenue", "revenue.mom_pct"], {
      x: 0,
      y: 0,
      w: 3,
      h: 2,
    }),
    w("kpi_gp", "kpi_card", "Gross margin", ["gross_margin_pct"], {
      x: 3,
      y: 0,
      w: 3,
      h: 2,
    }),
    w("kpi_ebitda", "kpi_card", "EBITDA", ["ebitda", "ebitda.mom_pct"], {
      x: 6,
      y: 0,
      w: 3,
      h: 2,
    }),
    w("kpi_cash", "kpi_card", "Cash and bank", ["cash_and_bank"], {
      x: 9,
      y: 0,
      w: 3,
      h: 2,
    }),
    w(
      "trend_revenue",
      "line",
      "Revenue and profit, year to date",
      ["revenue", "gross_profit", "pat"],
      { x: 0, y: 2, w: 8, h: 4 },
      { kind: "fy_to_date" },
    ),
    w(
      "bridge_profit",
      "waterfall",
      "From revenue to profit",
      ["revenue", "direct_costs", "employee_cost", "other_opex", "depreciation", "pat"],
      { x: 8, y: 2, w: 4, h: 4 },
    ),
    w(
      "costs",
      "stacked_bar",
      "Costs by month",
      ["direct_costs", "employee_cost", "other_opex"],
      { x: 0, y: 6, w: 6, h: 4 },
      { kind: "last_n", n: 6 },
    ),
    w(
      "working_capital",
      "table",
      "Working capital",
      ["receivables", "inventory", "payables", "dso", "dpo"],
      { x: 6, y: 6, w: 6, h: 4 },
    ),
  ],
});
