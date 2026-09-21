/**
 * The queries that read across every account have an index that fits them (ADR 0059).
 *
 * Nearly every index on a customer table leads with `account_id` or `company_id`, because that is
 * what a customer's own reads filter on. The money reports, the accounting exports and the worker
 * sweeps have the other shape: they filter by time or by state across the whole table, and none of
 * the tenant indexes serves that — so each of these full-scanned one of the fastest-growing tables.
 *
 * `enable_seqscan = off` is the point of these tests, not a cheat. It asks the planner the only
 * question that matters here: is there an index that *can* answer this predicate? On a table with
 * fifty rows the planner would rightly scan it whatever indexes exist, so the plan on seeded data
 * would prove nothing. What a future change could break is the fit between the index and the
 * query, and that is what this measures.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestDb, type TestDb } from "./harness";

let db: TestDb | undefined;
beforeAll(async () => {
  db = await startTestDb();
}, 180_000);
afterAll(async () => {
  await db?.stop();
});
const pool = () => {
  if (db === undefined) throw new Error("db not started");
  return db.pool;
};

/** The plan for a query, with sequential scans priced out of the running. */
async function plan(sql: string): Promise<string> {
  const client = await pool().connect();
  try {
    await client.query("set enable_seqscan = off");
    const r = await client.query<{ "QUERY PLAN": string }>(`explain (costs off) ${sql}`);
    return r.rows.map((row) => row["QUERY PLAN"]).join("\n");
  } finally {
    client.release();
  }
}

/** Every query here is one the product runs on a timer or on a page the owner opens. */
const reads: readonly {
  readonly what: string;
  readonly index: string;
  readonly sql: string;
}[] = [
  {
    what: "the consumption run rate on the business page",
    index: "credit_ledger_entry_time_idx",
    sql: `select coalesce(sum(amount), 0) from public.credit_ledger
            where entry_type = 'capture' and created_at >= now() - interval '30 days'`,
  },
  {
    what: "cash collected, and the margin report's gateway fees",
    index: "purchases_settled_idx",
    sql: `select currency, sum(total_minor) from public.purchases
            where method = 'razorpay' and status in ('paid', 'credited')
              and credited_at >= now() - interval '30 days' and credited_at < now()
            group by currency`,
  },
  {
    what: "the margin report over a date range for every account",
    index: "ai_calls_time_idx",
    sql: `select count(*) from public.ai_calls
            where created_at >= now() - interval '30 days' and created_at < now()`,
  },
  {
    what: "the monthly GST summary and invoice register",
    index: "invoices_issued_idx",
    sql: `select count(*) from public.invoices
            where type in ('tax_invoice', 'credit_note')
              and issued_at >= now() - interval '30 days' and issued_at < now()`,
  },
  {
    what: "the worker's sweep for chat messages left mid-flight",
    index: "chat_messages_stuck_idx",
    sql: `select id from public.chat_messages
            where role = 'user' and state in ('pending', 'running', 'needs_query')
              and created_at < now()`,
  },
  {
    what: "the admin lockout counter, run on every sign-in attempt",
    index: "audit_log_admin_login_failed_idx",
    sql: `select count(*) from public.audit_log
            where action = 'admin.login_failed' and metadata->>'email' = 'someone@example.test'
              and created_at > now() - interval '1 day'`,
  },
];

describe("the reports and sweeps read by index, not by scanning", () => {
  for (const read of reads) {
    it(`${read.what} uses ${read.index}`, async () => {
      expect(await plan(read.sql)).toContain(read.index);
    });
  }

  it("leaves the tenant reads on their own account-leading indexes", async () => {
    // The other half of the rule: a customer's own reads must still be answered by an index that
    // starts with their account, or one tenant's growth would slow every other tenant's page.
    expect(
      await plan(
        `select id from public.jobs where account_id = '00000000-0000-4000-8000-000000000001'::uuid
         order by created_at desc limit 50`,
      ),
    ).toContain("jobs_account_created_idx");
    expect(
      await plan(
        `select seq from public.credit_ledger where account_id = '00000000-0000-4000-8000-000000000001'::uuid
         order by seq desc limit 1`,
      ),
    ).toContain("credit_ledger_account_seq_idx");
  });
});
