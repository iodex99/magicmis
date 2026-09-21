import "server-only";

import { dashboardSpecSchema, unknownMetrics } from "@magicmis/render-dashboard";
import { z } from "zod";

import {
  runStage,
  type AiContext,
  type StageResult,
  type StageSpec,
} from "./orchestrator";

/**
 * Choosing the boxes for a company's first dashboard (ADR 0056).
 *
 * Every company used to get the same eight boxes, which suited a trading company and nobody
 * else: a consultancy got a stock-days row that would never hold a figure, and its payroll by
 * designation was computed every month and shown nowhere. What a business is read by depends on
 * what it does, and the books already say which it is — inventory and direct costs, payroll
 * split by designation, bills ageing.
 *
 * The model chooses the layout only. It is told which metrics this company actually holds
 * figures for and it may use no others, so a box cannot be put on the board that shows a dash
 * for ever. It never produces a figure: locked decision 7 holds here as everywhere, which is
 * why a title may not contain a digit at all. The limit on a box is a field, not a word in its
 * name.
 *
 * If this cannot run — no active prompt version, a routing failure, the cost cap — the caller
 * keeps the standard dashboard. A company is never left without one.
 */

export const dashboardLayoutInput = z.object({
  /** Every metric the catalog holds: id, unit, label. */
  metrics: z
    .array(
      z.object({
        id: z.string().max(60),
        unit: z.string().max(20),
        label: z.string().max(120),
      }),
    )
    .max(400),
  /** Of those, the ones this company actually has figures for. The model may use no others. */
  present: z.array(z.string().max(60)).max(400),
  /** Metrics the books split up, and the values that split takes. */
  dimensioned: z
    .array(
      z.object({
        metricId: z.string().max(60),
        dimension: z.string().max(30),
        values: z.array(z.string().max(80)).max(30),
      }),
    )
    .max(20),
  /** How many months of figures there are: year-on-year needs more than a year of them. */
  months: z.number().int().min(1).max(600),
});
export type DashboardLayoutInput = z.infer<typeof dashboardLayoutInput>;

export const dashboardLayoutOutput = z.object({
  /** Why this layout suits this company, in plain words and with no digits. */
  summary: z.string().min(1).max(300),
  /** The array of boxes, as JSON text. Validated against the dashboard schema below. */
  widgets_json: z.string().min(2).max(20_000),
  /** Formulas, as JSON text. Null for a first layout. */
  calculated_json: z.string().max(8000).nullable(),
});
export type DashboardLayoutOutput = z.infer<typeof dashboardLayoutOutput>;

const table = (rows: readonly (readonly string[])[]): string =>
  rows.map((r) => r.map((c) => c.replace(/[\t\n\r]/gu, " ")).join("\t")).join("\n");

/** The proposed spec, or the reasons it was refused. Shared by the check and the caller. */
export function specFromLayout(
  input: DashboardLayoutInput,
  output: DashboardLayoutOutput,
):
  | { ok: true; spec: z.infer<typeof dashboardSpecSchema> }
  | { ok: false; problems: string[] } {
  const problems: string[] = [];
  if (/\p{Nd}/u.test(output.summary)) problems.push("summary: must not contain digits");

  const parse = (label: string, json: string | null): unknown => {
    if (json === null) return [];
    try {
      return JSON.parse(json) as unknown;
    } catch {
      problems.push(`${label}: not valid JSON`);
      return [];
    }
  };
  const widgets = parse("widgets_json", output.widgets_json);
  const calculated = parse("calculated_json", output.calculated_json);
  if (problems.length > 0) return { ok: false, problems };

  const candidate = dashboardSpecSchema.safeParse({
    schemaVersion: 1,
    grid: { columns: 12 },
    filters: { period: { default: "latest" }, dimension: null },
    widgets,
    calculated,
  });
  if (!candidate.success)
    return {
      ok: false,
      problems: candidate.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };

  // A title is words, never a figure (locked decision 7). There is no request here to have
  // typed a number, so any digit in a title is the model's own and is refused.
  for (const w of candidate.data.widgets)
    if (/\p{Nd}/u.test(w.title))
      problems.push(`widget ${w.id}: its title must not contain digits`);

  // Only metrics this company actually holds. A box for a figure that will never arrive shows
  // a dash every month and teaches the customer to distrust the board.
  const has = new Set(input.present);
  const unknown = unknownMetrics(candidate.data, new Set(input.metrics.map((m) => m.id)));
  problems.push(...unknown.map((m) => `metric ${m} is not one this dashboard can show`));
  for (const w of candidate.data.widgets)
    for (const m of w.metrics) {
      const base = m.split(".")[0] ?? m;
      if (!base.startsWith("calc_") && !has.has(base))
        problems.push(`widget ${w.id}: this company has no figures for ${base}`);
    }

  // A breakdown has to name a split the books actually make.
  const splits = new Map(input.dimensioned.map((d) => [d.metricId, d.dimension]));
  for (const w of candidate.data.widgets) {
    if (w.kind !== "breakdown") continue;
    const metric = w.metrics[0] ?? "";
    if (splits.get(metric) !== w.dimension)
      problems.push(
        `widget ${w.id}: ${metric} is not split by ${w.dimension ?? "anything"}`,
      );
  }

  if (candidate.data.widgets.length === 0)
    problems.push("a dashboard needs at least one box");
  return problems.length > 0
    ? { ok: false, problems }
    : { ok: true, spec: candidate.data };
}

export const dashboardLayoutStageSpec: StageSpec<
  DashboardLayoutInput,
  DashboardLayoutOutput
> = {
  stage: "dashboard_layout",
  promptName: "dashboard_layout",
  input: dashboardLayoutInput,
  output: dashboardLayoutOutput,
  maxInputBytes: 64_000,
  stable: (input) => [
    `Allowed metric IDs (id, unit, label):\n${table(input.metrics.map((m) => [m.id, m.unit, m.label]))}`,
  ],
  volatile: (input) =>
    [
      `months of figures: ${input.months.toString()}`,
      "metrics this company has figures for:",
      input.present.join(", "),
      "metrics the books split up (metric, dimension, values):",
      table(
        input.dimensioned.map((d) => [d.metricId, d.dimension, d.values.join(" | ")]),
      ),
    ].join("\n"),
  check: (input, output) => {
    const r = specFromLayout(input, output);
    return r.ok ? [] : r.problems;
  },
};

export function proposeDashboardLayout(
  ctx: AiContext,
  input: DashboardLayoutInput,
): Promise<StageResult<DashboardLayoutOutput>> {
  return runStage(ctx, dashboardLayoutStageSpec, input);
}
