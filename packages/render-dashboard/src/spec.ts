/**
 * Dashboard spec (SPEC §24.2): data, not code. A grid of widgets bound to metric IDs, dimensions
 * and periods; global period and dimension filters; drilldown to another widget or the lineage
 * panel. Renderers read only this spec and the metric store; nothing generated is executed.
 *
 * ADR 0046 made the dashboard something the chat builds: a `comparison` box, a last-year series on
 * trend charts, and `calculated` metrics — formulas as data, computed by the engine. **Every
 * addition is optional with a default**, because a saved dashboard is read strictly (ADR 0045): a
 * field that an older saved dashboard lacks must never make it unreadable.
 */

// The subpath, not the package root: this module reaches the browser, the engine does not.
import {
  calculatedMetricSchema,
  metricsIn as metricIdsOf,
} from "@magicmis/engine/calculated";
import { z } from "zod";

const id = z.string().regex(/^[a-z0-9_]{1,40}$/u);
const metricId = z.string().regex(/^[a-z_]{1,60}(\.[a-z_]{1,20})?$/u);
/** How long a box title may be. Named because the stage that writes one is told it. */
export const WIDGET_TITLE_MAX = 80;

export const WIDGET_KINDS = [
  "kpi_card",
  "line",
  "bar",
  "stacked_bar",
  "waterfall",
  "table",
  "ageing_chart",
  /** One bar per value of the box's dimension, for its first metric. Sorted and capped below. */
  "breakdown",
  /** Each metric this month against a basis month: both figures, the change and the change %. */
  "comparison",
] as const;

/** What a box compares against. On a trend chart `last_year` adds the same months a year back. */
export const COMPARE_BASES = ["none", "previous_month", "last_year"] as const;
export type CompareBasis = (typeof COMPARE_BASES)[number];

export const widgetSchema = z
  .object({
    id,
    kind: z.enum(WIDGET_KINDS),
    title: z.string().min(1).max(WIDGET_TITLE_MAX),
    metrics: z.array(metricId).min(1).max(8),
    /**
     * Dimension to split by (e.g. `party`, `bucket`); null for totals, and absent means null.
     *
     * The second field found with the same wart as `drilldown` (ADR 0066): nullable but still
     * required, so a producer with nothing to split by had to say so explicitly or lose the
     * whole board. Absent and null mean the same thing here — show the total — so they are
     * read the same way.
     */
    dimension: z
      .string()
      .regex(/^[a-z_]{1,30}$/u)
      .nullish()
      .transform((d) => d ?? null),
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
    /*
     * Where the box leads when it is opened. Absent or null means lineage, which is what every
     * box offers anyway: Investigate is on all of them (ADR 0047), and drilling to another box
     * is the deliberate exception. It defaults like `compare`, `sort` and `limit` beside it, so
     * a saved dashboard that predates the field still reads and a producer that has nothing
     * special to say can leave it out rather than guess.
     */
    drilldown: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("lineage") }),
        z.object({ kind: z.literal("widget"), widgetId: id }),
      ])
      .nullish()
      .transform((d) => d ?? ({ kind: "lineage" } as const)),
    compare: z.enum(COMPARE_BASES).default("none"),
    /*
     * How a box with many rows orders and trims them (ADR 0056).
     *
     * Only a box split by a dimension has rows to order: payroll by designation, ageing by
     * bucket, anything later split by party or head. Both are optional and default to leaving
     * the data as the engine produced it, because a saved dashboard made before they existed
     * must still read (ADR 0045) and because an age bucket already has the one order that
     * means anything.
     */
    sort: z
      .object({
        by: z.enum(["value", "label"]),
        direction: z.enum(["asc", "desc"]),
      })
      .strict()
      .nullable()
      .default(null),
    /** Keep only the first rows after sorting: the top ten by value, and so on. */
    limit: z.number().int().min(1).max(50).nullable().default(null),
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
    /** Formulas the customer asked for, computed by the engine (`evaluateCalculated`). */
    calculated: z.array(calculatedMetricSchema).max(20).default([]),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const formulas = new Set<string>();
    for (const c of spec.calculated) {
      if (formulas.has(c.id))
        ctx.addIssue({ code: "custom", message: `duplicate calculated metric ${c.id}` });
      formulas.add(c.id);
    }
    for (const w of spec.widgets)
      for (const m of w.metrics) {
        const base = m.split(".")[0] ?? m;
        if (base.startsWith("calc_") && !formulas.has(base))
          ctx.addIssue({
            code: "custom",
            message: `widget ${w.id} shows ${base}, which has no formula in /calculated`,
          });
      }
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
  sort: null,
  limit: null,
  compare: "none",
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

const COMPARISON_SUFFIXES = new Set(["mom_abs", "mom_pct", "yoy_abs", "yoy_pct"]);
const STORE_SUFFIXES = new Set([...COMPARISON_SUFFIXES, "ytd", "ly_ytd", "variance"]);

/**
 * Metric ids a dashboard shows that nothing will ever compute: not in the catalog, not a formula
 * of this dashboard, or a suffix the store does not hold. Deliberately **not** part of the schema:
 * a saved dashboard is read strictly (ADR 0045), and a catalog that later drops a metric must
 * cost that box its figure, not the company its whole dashboard. It is checked where a change is
 * proposed, so the chat is sent back to repair it before anything is stored.
 */
export function unknownMetrics(
  spec: DashboardSpec,
  catalogIds: ReadonlySet<string>,
): string[] {
  const formulas = new Set(spec.calculated.map((c) => c.id));
  const bad = new Set<string>();
  const check = (metricId: string, suffixes: ReadonlySet<string>) => {
    const [base = "", suffix] = metricId.split(".");
    const known = base.startsWith("calc_") ? formulas.has(base) : catalogIds.has(base);
    const allowed = base.startsWith("calc_") ? COMPARISON_SUFFIXES : suffixes;
    if (!known || (suffix !== undefined && !allowed.has(suffix))) bad.add(metricId);
  };
  for (const w of spec.widgets) for (const m of w.metrics) check(m, STORE_SUFFIXES);
  for (const c of spec.calculated)
    for (const m of metricIdsOf(c.expr)) check(m, STORE_SUFFIXES);
  return [...bad];
}
