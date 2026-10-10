import "server-only";

import type { Pool } from "pg";
import { z } from "zod";

/**
 * What the portfolio says about each company beyond its month (ADR 0087): how its last run went,
 * and how many of its latest checks failed. One query for every company, reading only states and
 * check outcomes — nothing is decrypted to draw the list.
 */
export interface PortfolioFacts {
  readonly lastRun: { readonly state: string; readonly at: Date } | null;
  readonly toLook: number;
}

const RUNS = [
  "company_setup",
  "monthly_refresh",
  "refresh_with_restructure",
  "reference_mis_recreate",
];

const outcomes = z
  .array(z.object({ status: z.string(), severity: z.string() }).loose())
  .catch([]);

export async function portfolioFacts(
  pool: Pool,
  accountId: string,
): Promise<Map<string, PortfolioFacts>> {
  const r = await pool.query<{
    id: string;
    last_state: string | null;
    last_at: Date | null;
    checks: unknown;
  }>(
    `select c.id,
            last.state as last_state, last.created_at as last_at,
            (select s.validation_results from public.snapshots s
              where s.company_id = c.id and s.account_id = c.account_id
              order by s.period desc, s.version desc limit 1) as checks
       from public.companies c
       left join lateral (
         select j.state, j.created_at from public.jobs j
          where j.company_id = c.id and j.account_id = c.account_id and j.type = any($2)
            and j.state not in ('draft', 'estimated', 'cancelled')
          order by j.created_at desc limit 1
       ) last on true
      where c.account_id = $1 and c.deleted_at is null`,
    [accountId, RUNS],
  );
  return new Map(
    r.rows.map((row) => [
      row.id,
      {
        lastRun:
          row.last_state === null || row.last_at === null
            ? null
            : { state: row.last_state, at: row.last_at },
        toLook: outcomes.parse(row.checks).filter((c) => c.status === "fail").length,
      },
    ]),
  );
}
