import "server-only";

import type { Pool } from "pg";

/**
 * Counts for the summary cards on the Companies page.
 *
 * Everything here is a count of the account's own artefacts -- companies it created,
 * workbooks it already paid for, credits it already bought. SPEC §2.3 forbids previewing
 * analysis before a charge; it does not forbid telling an account what it already owns.
 */
export interface AccountOverview {
  readonly activeCompanies: number;
  readonly archivedCompanies: number;
  readonly workbooks: number;
  /** Completed jobs per month, oldest first, for the last twelve months. */
  readonly jobsByMonth: readonly number[];
  readonly creditsSpent90Days: string;
  readonly latestWorkbookAt: Date | null;
}

export async function accountOverview(
  pool: Pool,
  accountId: string,
): Promise<AccountOverview> {
  const [companies, outputs, jobs, spend] = await Promise.all([
    pool.query<{ lifecycle_state: string; n: string }>(
      `select lifecycle_state, count(*)::text as n from public.companies
       where account_id = $1 and deleted_at is null group by lifecycle_state`,
      [accountId],
    ),
    pool.query<{ n: string; latest: Date | null }>(
      `select count(*)::text as n, max(created_at) as latest from public.outputs where account_id = $1`,
      [accountId],
    ),
    pool.query<{ month: string; n: string }>(
      `select to_char(date_trunc('month', created_at), 'YYYY-MM') as month, count(*)::text as n
       from public.jobs
       where account_id = $1 and state = 'completed' and created_at >= date_trunc('month', now()) - interval '11 months'
       group by 1`,
      [accountId],
    ),
    pool.query<{ spent: string }>(
      `select coalesce(sum(captured_credits), 0)::text as spent from public.jobs
       where account_id = $1 and state = 'completed' and created_at >= now() - interval '90 days'`,
      [accountId],
    ),
  ]);

  // These are row counts, not amounts: `Number.parseInt` rather than the money helpers.
  const count = (value: string): number => Number.parseInt(value, 10);
  const byState = new Map(companies.rows.map((r) => [r.lifecycle_state, count(r.n)]));
  const counts = new Map(jobs.rows.map((r) => [r.month, count(r.n)]));
  const months: number[] = [];
  const cursor = new Date();
  cursor.setUTCDate(1);
  for (let back = 11; back >= 0; back -= 1) {
    const d = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - back, 1));
    const key = `${String(d.getUTCFullYear())}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    months.push(counts.get(key) ?? 0);
  }

  return {
    activeCompanies: (byState.get("active") ?? 0) + (byState.get("grace") ?? 0),
    archivedCompanies: byState.get("archived") ?? 0,
    workbooks: count(outputs.rows[0]?.n ?? "0"),
    jobsByMonth: months,
    creditsSpent90Days: spend.rows[0]?.spent ?? "0",
    latestWorkbookAt: outputs.rows[0]?.latest ?? null,
  };
}
