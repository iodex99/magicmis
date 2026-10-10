-- 0086: indexes the performance audit found missing (ADR 0091).
--
-- Each was checked with `enable_seqscan = off` against the query that needs it, as migration 0057's
-- were (ADR 0059), and `packages/db/test/report-indexes.test.ts` keeps them fitting.

-- A chat message's AI cost, read on every quick, edit and Deep round (`chatAiContext`) and once per
-- message in the margin report and the billing export: it scanned every AI call on the platform.
create index ai_calls_chat_message_idx
  on public.ai_calls (chat_message_id) where chat_message_id is not null;

-- A job's workbook, read by the job page and polled every four seconds while a run works.
create index outputs_job_idx on public.outputs (job_id, created_at desc);

-- The account overview's count of workbooks and the latest one.
create index outputs_account_idx on public.outputs (account_id, created_at desc);

-- The admin console's job detail reads a hold's ledger rows by reservation.
create index credit_ledger_reservation_idx
  on public.credit_ledger (reservation_id) where reservation_id is not null;
