-- 0078: the in-app inbox (ADR 0087).
--
-- Every notice the worker emails — a run finished or failed, a quote waiting, a month due, a low
-- balance, a sign-in — is already a row here, with ids and labels and never a figure (SPEC §29).
-- The inbox shows the same rows inside the app, newest first, so a customer who missed an email
-- still sees it; this records when they have.
alter table public.notifications add column read_at timestamptz;

-- The inbox and its unread count read one account's newest notices.
create index notifications_account_recent_idx
  on public.notifications (account_id, created_at desc);
