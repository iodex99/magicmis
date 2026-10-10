/**
 * A company's alerts (ADR 0087): kept per company, checked when a run completes, and noticed by
 * how many fired — never by a figure (SPEC §29). Checking reads the figures the run has just
 * computed and calls no model, so a monthly refresh stays free of AI calls.
 */

import {
  firedAlerts,
  type AlertComparator,
  type AlertRule,
} from "@magicmis/render-dashboard";
import type { MetricValue } from "@magicmis/engine";
import type { Pool } from "pg";

import { queueNotification } from "./notify";

/** At most this many per company: a short list someone reads, not a monitoring system. */
export const MAX_ALERTS = 10;

export class AlertError extends Error {
  constructor(
    readonly code: "unknown_metric" | "bad_threshold" | "too_many" | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "AlertError";
  }
}

export async function listAlerts(
  pool: Pool,
  scope: { accountId: string; companyId: string },
): Promise<AlertRule[]> {
  const r = await pool.query<{
    id: string;
    metric_id: string;
    comparator: AlertComparator;
    threshold: string;
  }>(
    `select id, metric_id, comparator, threshold from public.company_alerts
      where account_id = $1 and company_id = $2 and deleted_at is null
      order by created_at`,
    [scope.accountId, scope.companyId],
  );
  return r.rows.map((a) => ({
    id: a.id,
    metricId: a.metric_id,
    comparator: a.comparator,
    threshold: a.threshold,
  }));
}

/**
 * Adds an alert. `allowed` is the set of metrics an alert may watch, which the caller takes from
 * the library; the threshold is already in the metric's own unit.
 */
export async function addAlert(
  pool: Pool,
  scope: { accountId: string; companyId: string },
  input: {
    metricId: string;
    comparator: AlertComparator;
    threshold: string;
    allowed: ReadonlySet<string>;
  },
): Promise<AlertRule> {
  if (!input.allowed.has(input.metricId))
    throw new AlertError("unknown_metric", "Choose a figure from the list.");
  if (!/^-?[0-9]{1,20}(\.[0-9]{1,6})?$/u.test(input.threshold))
    throw new AlertError("bad_threshold", "Enter the threshold as a number.");
  // Counted and inserted under a lock on the company, so parallel requests cannot each see room
  // for one more and all add it.
  const client = await pool.connect();
  try {
    await client.query("begin");
    const company = await client.query(
      `select 1 from public.companies
        where id = $2 and account_id = $1 and deleted_at is null and purged_at is null
        for update`,
      [scope.accountId, scope.companyId],
    );
    if (company.rowCount === 0) throw new AlertError("not_found", "Company not found.");
    const count = await client.query<{ n: number }>(
      `select count(*)::int as n from public.company_alerts
        where account_id = $1 and company_id = $2 and deleted_at is null`,
      [scope.accountId, scope.companyId],
    );
    if ((count.rows[0]?.n ?? 0) >= MAX_ALERTS)
      throw new AlertError(
        "too_many",
        `A company can have ${MAX_ALERTS.toString()} alerts. Remove one to add another.`,
      );
    const r = await client.query<{ id: string }>(
      `insert into public.company_alerts (account_id, company_id, metric_id, comparator, threshold)
       values ($1, $2, $3, $4, $5) returning id`,
      [
        scope.accountId,
        scope.companyId,
        input.metricId,
        input.comparator,
        input.threshold,
      ],
    );
    await client.query("commit");
    return {
      id: r.rows[0]?.id ?? "",
      metricId: input.metricId,
      comparator: input.comparator,
      threshold: input.threshold,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function removeAlert(
  pool: Pool,
  scope: { accountId: string; companyId: string },
  id: string,
): Promise<void> {
  const r = await pool.query(
    `update public.company_alerts set deleted_at = now()
      where id = $1 and account_id = $2 and company_id = $3 and deleted_at is null`,
    [id, scope.accountId, scope.companyId],
  );
  if (r.rowCount === 0) throw new AlertError("not_found", "That alert is not there.");
}

/**
 * After a run: which alerts fire on the month it delivered, and one notice saying how many. Once
 * per company and month, so a month run again does not say it twice. Returns how many fired.
 */
export async function noticeFiredAlerts(
  pool: Pool,
  scope: { accountId: string; companyId: string },
  period: string,
  values: readonly MetricValue[],
): Promise<number> {
  const fired = firedAlerts(await listAlerts(pool, scope), values, period);
  if (fired.length === 0) return 0;
  const company = await pool.query<{ name: string }>(
    `select name from public.companies where id = $1 and account_id = $2`,
    [scope.companyId, scope.accountId],
  );
  await queueNotification(pool, {
    accountId: scope.accountId,
    type: "alerts.fired",
    payload: {
      company_id: scope.companyId,
      company_name: company.rows[0]?.name ?? "",
      count: fired.length,
    },
    dedupeKey: `alerts:${scope.companyId}:${period}`,
  });
  return fired.length;
}
