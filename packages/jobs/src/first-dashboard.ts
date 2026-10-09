import {
  jobAiContext,
  proposeDashboardLayout,
  specFromLayout,
  type AiTransport,
  type DashboardLayoutInput,
} from "@magicmis/ai";
import { latestMetricStores } from "@magicmis/engine/server";
import type { KeyWrapper } from "@magicmis/crypto";
import { DEFAULT_DASHBOARD, type DashboardSpec } from "@magicmis/render-dashboard";
import { METRIC_CATALOG } from "@magicmis/templates";
import type { Pool } from "pg";

/**
 * The boxes a company's first dashboard opens with (ADR 0056).
 *
 * Every company used to get the same eight. A consultancy got a stock-days row that would never
 * hold a figure, while its payroll split by designation was computed every month and shown
 * nowhere. What a business is read by depends on what it does, and its own books already say
 * which it is.
 *
 * So the first dashboard is chosen for the company from the figures it actually holds. Three
 * things keep that safe:
 *
 * - **It runs once.** Only where there is no dashboard yet. A monthly refresh still makes no AI
 *   call at all, which is where the recurring margin comes from.
 * - **It cannot fail the job.** No active prompt version, a routing failure, the cost cap: any
 *   of them keeps the standard dashboard. A company is never left without one, and the customer
 *   is never stopped for a quote over a layout they did not ask for.
 * - **It cannot invent.** The model is told which metrics this company holds and may use no
 *   others, and a title may not contain a digit. Every figure on the board is still the
 *   engine's.
 */
/**
 * What the stage is told about a company: which metrics it holds, which of them its books split,
 * and how many months there are.
 *
 * **Only metrics the board can show** (ADR 0084). The engine also computes figures the dashboard
 * catalog does not hold — payroll by designation, headcount, gross pay — and offering them was a
 * trap: the model, rightly reading a people business, chose a payroll box, the check refused it
 * as a metric "this dashboard can show", the repair round did the same, and the company was
 * quietly given the standard eight boxes. The first run against the real model found it on the
 * first services company it saw.
 */
/** The three fields of a stored metric value the layout reads. */
interface LayoutValue {
  readonly metricId: string;
  readonly dims: Readonly<Record<string, string>>;
  readonly value: string | null;
}

export function layoutInputFor(
  values: readonly LayoutValue[],
  months: number,
): DashboardLayoutInput {
  const showable = new Set(METRIC_CATALOG.map((m) => m.id));
  const present = new Set<string>();
  const splits = new Map<string, { dimension: string; values: Set<string> }>();
  for (const v of values) {
    // A figure with no value teaches the customer to distrust the board, so it does not count
    // as present.
    if (v.value === null) continue;
    const base = v.metricId.split(".")[0] ?? v.metricId;
    if (!showable.has(base)) continue;
    present.add(base);
    const [dimension] = Object.keys(v.dims);
    if (dimension === undefined) continue;
    const seen = splits.get(base) ?? { dimension, values: new Set<string>() };
    const value = v.dims[dimension];
    if (value !== undefined) seen.values.add(value);
    splits.set(base, seen);
  }
  return {
    metrics: METRIC_CATALOG.map((m) => ({ id: m.id, unit: m.unit, label: m.label })),
    present: [...present].sort(),
    dimensioned: [...splits.entries()]
      // The count, never the values: see the note on `dimensioned` (ADR 0057).
      .map(([metricId, s]) => ({
        metricId,
        dimension: s.dimension,
        valueCount: s.values.size,
      }))
      .slice(0, 20),
    months,
  };
}

export async function firstDashboardSpec(
  pool: Pool,
  wrapper: KeyWrapper,
  input: {
    accountId: string;
    companyId: string;
    jobId: string;
    transport: AiTransport | null;
  },
): Promise<DashboardSpec> {
  if (input.transport === null) return DEFAULT_DASHBOARD;
  try {
    const periods = await pool.query<{ period: string }>(
      `select distinct period from public.snapshots where company_id = $1 and account_id = $2
        order by period desc limit 24`,
      [input.companyId, input.accountId],
    );
    if (periods.rows.length === 0) return DEFAULT_DASHBOARD;

    const stores = await latestMetricStores(pool, wrapper, {
      accountId: input.accountId,
      companyId: input.companyId,
      periods: periods.rows.map((p) => p.period),
    });
    const layout = layoutInputFor(
      [...stores.values()].flatMap((s) => s.values),
      periods.rows.length,
    );
    if (layout.present.length === 0) return DEFAULT_DASHBOARD;
    const ctx = await jobAiContext(pool, input.transport, input.jobId);
    const result = await proposeDashboardLayout(ctx, layout);
    const spec = specFromLayout(layout, result.output);
    return spec.ok ? spec.spec : DEFAULT_DASHBOARD;
  } catch {
    // Including a cost-cap pause: a layout is not worth stopping a delivered run for.
    return DEFAULT_DASHBOARD;
  }
}
