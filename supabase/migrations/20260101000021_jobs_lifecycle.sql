-- GENERATED from packages/db/migrations/0021_jobs_lifecycle.sql. Do not edit.
-- Phase 6 (SPEC §23, §24.1, §28, §29): memory-fee holds, fee charges, company lifecycle columns,
-- output encryption metadata, and job / lifecycle / output config.

-- The monthly memory fee is a fixed capture from the wallet (SPEC §28) with no job behind it: a
-- reservation may now belong to a company fee instead of a job or chat message.
alter table public.reservations add column company_id uuid references public.companies(id) on delete cascade;
alter table public.reservations drop constraint reservations_single_subject;
alter table public.reservations add constraint reservations_single_subject
  check (num_nonnulls(job_id, chat_message_id, company_id) = 1);

-- One fee per company per month, whatever the worker does (idempotency per company-month).
create table public.company_fee_charges (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  account_id     uuid not null references public.accounts(id) on delete cascade,
  fee_month      text not null check (fee_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  kind           text not null check (kind in ('memory_fee', 'restore')),
  credits        bigint not null check (credits >= 0),
  status         text not null check (status in ('captured', 'failed')),
  reservation_id uuid references public.reservations(id),
  created_at     timestamptz not null default now(),
  unique (company_id, fee_month, kind)
);
create index company_fee_charges_account_idx on public.company_fee_charges (account_id, created_at desc);

alter table public.company_fee_charges enable row level security;
alter table public.company_fee_charges force row level security;
create policy company_fee_charges_own on public.company_fee_charges
  for select using (app.owns(account_id));
revoke insert, update, delete, truncate on public.company_fee_charges from anon, authenticated;

alter table public.companies add column first_setup_at timestamptz;
alter table public.companies add column unpaid_months smallint not null default 0 check (unpaid_months >= 0);
alter table public.companies add column purge_after timestamptz;
alter table public.companies add column purged_at timestamptz;

-- Outputs are encrypted under the company data key before upload (SPEC §24.1).
alter table public.outputs add column sha256 text;
alter table public.outputs add column file_name text;

insert into public.app_config (key, value) values
  -- SPEC §23 refresh: share of changed sheet signatures above which a restructure price applies.
  ('jobs.drift_threshold', '"0.25"'::jsonb),
  -- ADR 0021: browser-reported platform faults release credits at most this many times per window;
  -- beyond it the job is charged as a data fault and flagged for review.
  ('jobs.platform_fault_release_limit', '3'::jsonb),
  ('jobs.platform_fault_window_days', '30'::jsonb),
  -- SPEC §19: remind this many hours before a review reservation expires.
  ('jobs.review_reminder_hours', '24'::jsonb),
  -- SPEC §28 (config): months unpaid before archive, months archived before purge.
  ('lifecycle.grace_months', '3'::jsonb),
  ('lifecycle.archive_months', '12'::jsonb),
  -- SPEC §28: notices before archive and purge, and low-balance notices before the fee date.
  ('lifecycle.archive_notice_days', '[30, 7]'::jsonb),
  ('lifecycle.purge_notice_days', '[30, 7]'::jsonb),
  ('lifecycle.low_balance_notice_days', '[7, 1]'::jsonb),
  -- TODO(review): R-36 — delay between a user deleting a company and crypto-shredding it.
  ('lifecycle.deletion_purge_delay_days', '30'::jsonb),
  -- TODO(review): R-36 — output file retention.
  ('outputs.retention_days', '365'::jsonb)
on conflict (key, version) do nothing;
