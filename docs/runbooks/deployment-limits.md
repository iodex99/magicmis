# Deployment limits: connections, memory and duration

Four settings that no code change can make for you, because they live in the Vercel and
Supabase dashboards. Getting them wrong does not show up as a bug; it shows up as an outage
under load, or as a run that dies part-way through a large file.

Decided in ADR [0054](../adr/0054-decisions-on-the-open-items.md), which closes R-73.

## 1. Point `DATABASE_URL` at the transaction pooler

Use the **transaction mode** pooler connection string from the Supabase dashboard
(Project Settings → Database → Connection string → Transaction mode), not the direct
connection.

Every warm serverless instance holds its own connection pool, so connections in flight are
the pool size multiplied by the number of instances. The direct connection has a hard ceiling
that a busy afternoon can reach, and when it does Postgres refuses new connections outright
rather than queuing: the symptom is `remaining connection slots are reserved for non-replication
superuser connections`, not a slow page.

Two things about this codebase make transaction mode safe:

- The role is set as a **connection startup parameter** (`options: "-c role=service_role"` in
  `apps/web/src/lib/db.ts`), which the pooler supports per connection. It is not `set role`,
  which transaction mode would not carry across statements.
- Every transaction that needs one takes its lock inside a single `withTransaction`, so no
  state is assumed between checkouts.

## 2. Leave the pool small, and only raise it for the worker

`db()` defaults to **5** connections per instance. That is deliberate: a serverless request
handles one logical operation at a time and the pooler is what fans them out.

`DATABASE_POOL_MAX` overrides it, and belongs on anything that is **not** one request at a
time:

- the **worker**, which is one long-lived process running several tasks at once; 10 is a
  reasonable starting point;
- the single Node server behind local development and the E2E run, which handles every
  concurrent chunk of an upload itself. The Playwright config sets 12 for exactly this reason:
  at 3 a 50 MB upload sent thirteen chunks at once and they queued behind each other, which
  looked like a slow product and was a starved pool.

Do not set it on the deployed web project, where the low default is the point.

## 3. Set function memory in the dashboard, not in `vercel.json`

**Memory cannot be set in `vercel.json` while Fluid compute is enabled**, and Fluid compute is
on by default. Set it under **Project Settings → Functions** instead.

This matters because a run holds a large file in memory more than once: the decrypted bytes,
the parsed grid, and the workbook being rendered. A 50 MB spreadsheet is the case to size for,
and the default is unlikely to carry it. Raise it, then upload the largest file you intend to
support and watch it through; the failure mode is the function being killed part-way, which
reaches the customer as a run that failed after they were charged nothing but waited.

`sources.max_file_bytes` (seeded at 100 MB) should be lowered to a size you have actually
watched succeed, rather than left at a number nobody has tested.

## 4. Duration is already set in code

`export const maxDuration = 300` on the run route is the Next.js way and needs nothing in
`vercel.json`. Check it against your plan's ceiling: if the plan allows less, the run is cut
off mid-flight rather than refused, and the job is settled by the sweeper rather than by the
request.

## What to watch after the first real traffic

- Connection count against the Supabase limit, at your busiest minute rather than on average.
- Function memory high-water mark on the run route.
- The margin dashboard's infrastructure line (R-67), which is a working figure until it is set
  from real invoices.
