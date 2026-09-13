-- SPEC §29 delivery bookkeeping for the worker (ADR 0010).
alter table public.notifications
  add column attempts integer not null default 0 check (attempts >= 0),
  add column last_error text,
  add column provider_message_id text,
  add column next_attempt_at timestamptz not null default now();

drop index if exists public.notifications_pending_idx;
create index notifications_pending_idx on public.notifications (next_attempt_at)
  where status = 'queued';

insert into public.app_config (key, value) values
  ('notifications.max_attempts', '5'::jsonb),
  ('notifications.retry_base_seconds', '60'::jsonb),
  ('notifications.batch_size', '50'::jsonb)
on conflict (key, version) do nothing;
