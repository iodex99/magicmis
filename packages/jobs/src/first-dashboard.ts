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
    const present = new Set<string>();
    const splits = new Map<string, { dimension: string; values: Set<string> }>();
    for (const store of stores.values())
      for (const v of store.values) {
        // A figure with no value teaches the customer to distrust the board, so it does not
        // count as present.
        if (v.value === null) continue;
        const base = v.metricId.split(".")[0] ?? v.metricId;
        present.add(base);
        const [dimension] = Object.keys(v.dims);
        if (dimension === undefined) continue;
        const seen = splits.get(base) ?? { dimension, values: new Set<string>() };
        const value = v.dims[dimension];
        if (value !== undefined) seen.values.add(value);
        splits.set(base, seen);
      }
    if (present.size === 0) return DEFAULT_DASHBOARD;

    const layout: DashboardLayoutInput = {
      metrics: METRIC_CATALOG.map((m) => ({ id: m.id, unit: m.unit, label: m.label })),
      present: [...present].sort(),
      dimensioned: [...splits.entries()]
        .map(([metricId, s]) => ({
          metricId,
          dimension: s.dimension,
          values: [...s.values].slice(0, 30),
        }))
        .slice(0, 20),
      months: periods.rows.length,
    };
    const ctx = await jobAiContext(pool, input.transport, input.jobId);
    const result = await proposeDashboardLayout(ctx, layout);
    const spec = specFromLayout(layout, result.output);
    return spec.ok ? spec.spec : DEFAULT_DASHBOARD;
  } catch {
    // Including a cost-cap pause: a layout is not worth stopping a delivered run for.
    return DEFAULT_DASHBOARD;
  }
}
