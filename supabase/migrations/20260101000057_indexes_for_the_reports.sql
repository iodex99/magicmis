-- GENERATED from packages/db/migrations/0057_indexes_for_the_reports.sql. Do not edit.
-- Indexes for the queries that read across every account (ADR 0059).
--
-- The tenant paths were already covered: nearly every index on a customer table leads with
-- `account_id` or `company_id`, which is what a customer's own reads filter on. What had no index
-- at all was the other shape — the money reports, the accounting exports and the sweeps, which
-- filter by *time* or by *state* across the whole table. Those full-scan today, on exactly the
-- tables that grow fastest.
--
-- Every index here is a read the product makes on a timer or on a page the owner opens, so the
-- write cost is one more B-tree entry on an append-only table and the read cost falls from a
-- whole-table scan to a range.

-- The consumption run rate on the business page, and the recognised-revenue figures beside it.
-- `credit_ledger` grows with every charge and every grant, and its only indexes led with
-- `account_id` or `seq`, so summing captures scanned all of it.
create index credit_ledger_entry_time_idx
  on public.credit_ledger (entry_type, created_at desc);

-- Cash collected, the margin report's gateway fees, and `credits_sold`. `purchases_status_idx` is
-- deliberately partial on `status <> 'credited'` — it exists to find the ones still in flight — so
-- it excludes precisely the rows every money report reads.
create index purchases_settled_idx
  on public.purchases (status, credited_at desc) where credited_at is not null;

-- The margin report over a date range with no account filter (the owner's view of the whole
-- platform). The existing indexes lead with `account_id` and `stage`, so neither serves it.
create index ai_calls_time_idx on public.ai_calls (created_at desc);

-- The monthly accounting exports: the GST summary and the invoice register both scan a month
-- across every account, and the only issued_at index leads with `account_id`.
create index invoices_issued_idx on public.invoices (issued_at);

-- `sweepChatMessages` runs on the worker and looks for messages left mid-flight. Partial, because
-- the rows it wants are a vanishing fraction of a table that grows with every message sent.
create index chat_messages_stuck_idx on public.chat_messages (created_at)
  where role = 'user' and state in ('pending', 'running', 'needs_query');

-- The admin lockout counter runs on **every** admin sign-in attempt, against the platform-wide
-- audit log — the largest append-only table there is. Partial and keyed on the email inside the
-- metadata, so the count is a short range read rather than a scan of every audit row ever
-- written. This is also what made the unauthenticated login endpoint an amplifier: each attempt
-- cost a full scan (ADR 0057 finding 3).
create index audit_log_admin_login_failed_idx
  on public.audit_log ((metadata->>'email'), created_at desc)
  where action = 'admin.login_failed';
