# ADR 0059: Indexes for the reports, and the one upload that was not idempotent

**Status:** accepted · **Date:** 2026-09-21 · **Decided by** the product owner ("does our project
have indexing and idempotency, if not build it")

## Context

Both were already there, and extensively: 140 indexes, 20 unique constraints enforcing
idempotency in the schema, and 17 API routes gated on an `Idempotency-Key`. The question was
still worth asking, because the coverage had a shape to it and the shape had a gap.

One correction to the premise, because it matters for where effort goes. **Idempotency is a
correctness property, not a performance one.** It is what stops a retried request charging twice
or granting credits twice; it costs a little performance rather than buying any. Indexing is the
one that buys speed — and it is not free either, since every index is another B-tree to maintain
on write. So neither is something to add more of by default; each one has to earn its place.

## What was missing, and why it had the shape it did

Nearly every index on a customer table leads with `account_id` or `company_id`, because that is
what a customer's own reads filter on. That is the right instinct and it was applied thoroughly.

The queries that had nothing were the other shape: the ones that read **across every account**,
filtering by time or by state. Those are the money reports, the monthly accounting exports and
the worker's sweeps — and every one of them full-scanned a table that grows without bound.

| Read | Table | Why nothing served it |
|---|---|---|
| Consumption run rate, recognised revenue | `credit_ledger` | Indexes led with `account_id` or `seq`; nothing on `entry_type` or `created_at` |
| Cash collected, gateway fees, `credits_sold` | `purchases` | `purchases_status_idx` is partial on `status <> 'credited'` — it excludes exactly the rows every money report reads |
| Margin report over a date range, all accounts | `ai_calls` | Indexes led with `account_id` and `stage`; the owner's own view filters on neither |
| GST summary and invoice register | `invoices` | The only `issued_at` index led with `account_id` |
| Sweep for chat messages left mid-flight | `chat_messages` | Only `(thread_id, created_at)`; nothing on `state` |
| Admin lockout counter | `audit_log` | Nothing on `action`, and this runs on **every** admin sign-in attempt against the largest append-only table there is |

That last one is also what made the unauthenticated admin login endpoint an amplifier (ADR 0057,
finding 3): each attempt cost a full scan of the platform-wide audit log.

Migration 0057 adds six indexes, one per row of that table, each matched to its predicate. Five
are plain or composite; two are partial, because the rows they want are a vanishing fraction of a
table that grows with every message or every audit row.

## The idempotency gap

Sixteen mutating routes do not take an `Idempotency-Key`. Fifteen of them are right not to:

- **auth** (sign-in, sign-up, sign-out, forgot, reset, finish) and **reauth** — a retry there is
  meant to be a fresh attempt, and they are throttled instead.
- **the Razorpay webhook** — de-duplicated by `webhook_events (provider, event_id)`, which is
  stronger, since the gateway controls the id.
- **`wallet/purchases/verify`** — grants nothing.
- **`pricing/preview`** — a POST that reads.
- **chunk upload, upload complete, upload delete, company rename** — naturally idempotent: the
  chunk write is `array_append … case when $2 = any(stored_chunks)`, and setting a name or a
  status twice gives the same result.
- **`jobs/:id/run`** — the state machine is the guard; it refuses anything not in `reserved`.

The sixteenth was a real gap. **`POST /api/companies/:id/uploads` creates a row**, and a retried
request created a second one for the same file. `companyStorage` counts every row that is not
deleted, at the size the *browser* declared, so one dropped connection on that call cost the
company that file's worth of its cap twice — with only one of the two on the file list, and the
other invisible until the six-hour expiry (ADR 0058) reaps it. It is idempotent now, like every
other route that creates something, and the browser sends a key per attempt.

## What this does not do

- **No index was added for the business page's unbounded aggregates.** `select … from ai_calls`
  with no time filter at all, grouped by stage and by model, will scan whatever indexes exist —
  that is a query shape to bound, not an index to add, and it belongs with whatever paging that
  page eventually needs.
- **The FIFO index on `credit_lots` was left alone.** ADR 0058 changed its sort to
  `created_at, (source = 'bonus'), id`, which the index no longer matches exactly, but ties are
  at most two rows — a purchase lot and its bonus — so the sort is free and an expression index
  would cost more than it saves.

## Tests

`packages/db/test/report-indexes.test.ts`: each of the six reads names the index that serves it,
and the tenant reads still land on their account-leading ones. The test plans with
`enable_seqscan = off` deliberately — on a table with fifty rows the planner would rightly scan
it whatever indexes exist, so a plan over seeded data would prove nothing. What a future change
can break is the *fit* between index and predicate, and that is what this measures. Writing it
caught two of my own mistakes: an index name I had guessed, and a `gen_random_uuid()` in the
predicate, which is volatile and which therefore no index can ever serve.
