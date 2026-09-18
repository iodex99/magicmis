import "server-only";

import { currencySymbol } from "@magicmis/core/reporting-conventions";

import type { NumberFormatOptions } from "@magicmis/core/format";
import { readConfig } from "@magicmis/db/config";
import type { MetricValue } from "@magicmis/engine";
import { evaluateCalculated } from "@magicmis/engine/calculated";
import { labelsFor } from "@magicmis/render-dashboard";
import { latestSnapshot } from "@magicmis/engine/server";
import {
  commentaryForJob,
  companyDashboard,
  type CompanyDashboard,
} from "@magicmis/jobs";
import type { Pool } from "pg";
import { z } from "zod";

import { keyWrapper } from "./runtime";

const MAX_PERIODS = 24;

export interface CompanyMetrics {
  readonly company: {
    id: string;
    name: string;
    fyStartMonth: number;
    money: NumberFormatOptions;
    /** The company's reporting currency and its symbol (ADR 0030). */
    currency: string;
    currencySymbol: string;
  };
  readonly periods: readonly string[];
  /** The account's own computed aggregates (SPEC §7 zone B → the owner's browser). */
  readonly values: readonly MetricValue[];
}

/**
 * Metric values across the company's stored months, newest snapshot first: a value restated by a
 * later snapshot wins over the older one.
 */
export async function companyMetrics(
  pool: Pool,
  accountId: string,
  companyId: string,
): Promise<CompanyMetrics | null> {
  const c = await pool.query<{
    id: string;
    name: string;
    fy_start_month: number;
    number_format: NumberFormatOptions["style"];
    currency: string;
    decimals: number;
  }>(
    `select id, name, fy_start_month, number_format, decimals, currency from public.companies
     where id = $1 and account_id = $2 and deleted_at is null and purged_at is null`,
    [companyId, accountId],
  );
  const company = c.rows[0];
  if (company === undefined) return null;
  const periods = await pool.query<{ period: string }>(
    `select distinct period from public.snapshots where company_id = $1 order by period desc limit $2`,
    [companyId, MAX_PERIODS],
  );
  const seen = new Set<string>();
  const values: MetricValue[] = [];
  for (const { period } of periods.rows) {
    const snapshot = await latestSnapshot(pool, keyWrapper(), {
      accountId,
      companyId,
      period,
    });
    for (const v of (snapshot?.metricStore.values ?? []) as unknown as MetricValue[]) {
      const key = `${v.metricId}@${v.period}|${JSON.stringify(v.dims)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      values.push(v);
    }
  }
  return {
    company: {
      id: company.id,
      name: company.name,
      fyStartMonth: company.fy_start_month,
      money: {
        style: company.number_format,
        decimals: company.decimals,
        negativesInBrackets: true,
      },
      currency: company.currency,
      currencySymbol: currencySymbol(company.currency),
    },
    periods: periods.rows.map((p) => p.period),
    values,
  };
}

export interface DashboardPayload extends CompanyMetrics {
  readonly dashboard: CompanyDashboard | null;
  /** The latest stored month, which may be newer than the dashboard's paid-for month. */
  readonly latestPeriod: string | null;
}

/**
 * The dashboard with only the values it has been paid for (SPEC §2.3): nothing before the add-on,
 * and nothing after `dataThrough` until a dashboard refresh.
 */
export async function dashboardPayload(
  pool: Pool,
  accountId: string,
  companyId: string,
): Promise<DashboardPayload | null> {
  const metrics = await companyMetrics(pool, accountId, companyId);
  if (metrics === null) return null;
  const dashboard = await companyDashboard(pool, keyWrapper(), { accountId, companyId });
  const through = dashboard?.dataThrough ?? null;
  const paid = (period: string) => through !== null && period <= through;
  const stored = metrics.values.filter((v) => paid(v.period));
  // Formulas the customer asked the chat for (ADR 0046): computed here by the engine, exactly,
  // from the months the dashboard has been paid for, and handed over as ordinary metric values
  // — so a calculated figure is drawn, formatted and traced like any other.
  const calculated =
    dashboard === null
      ? []
      : evaluateCalculated(
          dashboard.spec.calculated,
          stored,
          labelsFor(dashboard.spec.calculated),
        );
  return {
    company: metrics.company,
    periods: metrics.periods.filter(paid),
    values: [...stored, ...calculated],
    dashboard,
    latestPeriod: metrics.periods[0] ?? null,
  };
}

/** A completed commentary with what the browser needs to re-check and render it. */
export async function commentaryPayload(pool: Pool, accountId: string, jobId: string) {
  const stored = await commentaryForJob(pool, keyWrapper(), { accountId, jobId });
  if (stored === null) return null;
  const job = await pool.query<{ company_id: string }>(
    `select company_id from public.jobs where id = $1 and account_id = $2`,
    [jobId, accountId],
  );
  const companyId = job.rows[0]?.company_id;
  if (companyId === undefined) return null;
  const metrics = await companyMetrics(pool, accountId, companyId);
  if (metrics === null) return null;
  return {
    company: metrics.company,
    output: stored.output,
    pack: stored.input.factsPack,
    allowlist: await readConfig(pool, "commentary.digit_allowlist", z.array(z.string())),
    values: metrics.values.filter(
      (v) =>
        v.period === stored.input.factsPack.period ||
        stored.input.factsPack.periods.includes(`p:${v.period}`),
    ),
  };
}
