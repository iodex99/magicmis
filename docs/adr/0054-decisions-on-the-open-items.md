# ADR 0054: Decisions on the five items the audit left open

**Status:** accepted · **Date:** 2026-09-20 · **Decided by** the product owner ("take your best
decisions on those items") · **Closes** R-72, R-73, R-74, R-75 and R-76 from ADR
[0053](0053-what-the-audit-found.md)

## Context

ADR 0053 fixed twenty-eight defects and left five things it deliberately did not settle: the
snapshot read path, deployment limits, refunds, a test-runner advisory, and how the price in
force is chosen. The owner asked for a decision on each. Four are decided and done here. The
fifth is decided and is the owner's to carry out, because it lives in a dashboard.

## 1. Snapshot reads: batch them, and stop decrypting what nobody reads (R-72)

The dashboard and the chat both want one thing from a company's snapshots, the metric values
for every month on the board. Each was fetching them one period at a time, and every call
opened its own transaction, took the `company_keys` row lock, made a KMS call to unwrap the
same key again, and then decrypted and schema-validated the **ledger balances** as well — a
blob that grows with every month the company has ever loaded and which the caller discarded
unread. Two dozen months and a few thousand ledgers is hundreds of megabytes decrypted per
page load, plus two dozen serial KMS round trips, and the chat paid it on every message.

`latestMetricStores` reads them in one query, unwraps the key once, touches only the metric
store, and decrypts after the transaction has committed so the key row is not locked
throughout. `latestSnapshot` stays for the one caller that genuinely needs the balances.

**Not done, and why:** snapshots still carry every prior month, so stored bytes grow with the
square of the months held. Fixing that changes what a snapshot contains and therefore how the
cube reads prior periods — a change to the compute pipeline, not to a read path, and it
deserves its own work rather than being folded into this. Recorded as R-77.

## 2. Deployment limits: decide them, but most of them are not code (R-73)

Three of the four are settings in a dashboard, so the decision is to write them down precisely
rather than leave them implied. See [deployment-limits](../runbooks/deployment-limits.md).

What did change in code:

- **The connection pool is 5 per instance, not 10.** Every warm serverless instance holds its
  own pool, so connections in flight are the pool size times the number of instances; ten each
  could exhaust a small Postgres, which fails as a refusal rather than as slowness. A request
  handles one logical operation at a time. `DATABASE_POOL_MAX` raises it for any process that
  is not one-request-at-a-time: the worker, and the single Node server that serves local
  development and the E2E run, which handles every concurrent chunk of an upload itself. Three
  was tried first and was too tight for that single-process case: a 50 MB upload sends thirteen
  chunks at once and they queued behind each other.
- **Job polling backs off from 1.5 to 4 seconds.** It only moves a progress label, and it ran
  for the whole length of a run: a five-minute run spent two hundred function invocations on
  it, each able to wake a cold instance and open a pool of its own.

**Memory is explicitly not set in `vercel.json`**, because Vercel does not allow it there while
Fluid compute is enabled, and Fluid compute is the default. Verified against
https://vercel.com/docs/project-configuration/vercel-json (2026-09-20). It belongs in Project
Settings, and the runbook says so, along with the reason it matters: a run holds a large file
in memory more than once.

## 3. Refunds: record them, never act on them (R-74)

Credits are sold non-refundable and there is no cash-out, so nothing here reverses a grant.
Taking credits back could drive a balance negative, and credits already spent cannot be taken
back at all; that is a decision for a person, not for a webhook.

What was wrong was the silence. A refund issued in the gateway dashboard returned "ignored",
and our ledger and the gateway's diverged with nothing anywhere saying so. `refund.*` events
now mark the purchase refunded and write an audit entry. The credits stand, and somebody can
see that they do. Verified the payload carries `payload.payment.entity.order_id` against
https://razorpay.com/docs/webhooks/payloads/refunds/ (2026-09-20).

## 4. The test runner is upgraded (R-75)

`vitest` 3 → 4.1.11, which is the version that patches the path-traversal advisory. Checked
first that none of the options removed in 4 are in use, that Vite is already past 6 and Node
past 20. Every package passes. The advisory is gone; one moderate advisory remains in `uuid`,
reached through testcontainers and dockerode, which no change here can resolve.

## 5. The price in force: make the question stop being a question (R-76)

`priceBookEntry` orders by version, not by date, so a correction entered with a later
`effective_from` but a lower version number would be ignored. Ordering by date instead was
tried in ADR 0053 and reverted: it moves live prices for a narrow benefit, and it breaks on
seeded rows, which carry the migration's own timestamp and so beat anything deliberately
back-dated.

The real problem was never which column to order by. It was that the two could disagree at
all. Migration 0052 adds a trigger refusing any version that would come into force before an
earlier one. Every writer already allocates the next version number, so versions are in the
order the edits were made; now the dates agree with them, and the two orderings return the
same row by construction. No price moves.

## A note on measuring any of this here

While verifying these changes the browser suite failed twice, in three different places, and a
company setup that normally takes twenty-four seconds timed out at five minutes. None of it was
the code: a Postgres container left behind by a Testcontainers run twenty-six hours earlier was
burning a third of this machine's CPU, and Docker here has under four gigabytes to give.
Removing it put the same suite back to twelve passes in three and a half minutes.

That is the second time in two days that a performance number taken on this machine turned out
to be the machine rather than the product (the first is in R-73). **Before believing any timing
taken here, check `docker ps` for an orphaned `postgres:17-alpine` container**, which is what a
Testcontainers run leaves when its reaper dies. CI runs the same suite on native Docker and is
the better arbiter.

## Tests

`packages/wallet/test/pricing.test.ts`: a later version back-dated before an earlier one is
refused, and the two existing version tests now build the arrangement the trigger permits.
`packages/billing/test/billing.test.ts`: a refund is recorded, the purchase says so, the audit
log has it, and the balance is untouched. The rest of the suite is the regression test for the
batched snapshot read, since every dashboard and chat test goes through it.
