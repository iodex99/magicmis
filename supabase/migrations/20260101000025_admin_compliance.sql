-- GENERATED from packages/db/migrations/0025_admin_compliance.sql. Do not edit.
-- Phase 9 (SPEC §26, §30, §31, §10): break-glass access, rate limits, account deletion and purge,
-- margin dashboard inputs, legal document versions.

-- SPEC §26: an admin may see decrypted customer data only under a time-limited grant with a
-- written reason. Grants are never updated except to revoke; every use is audit-logged.
create table public.break_glass_grants (
  id            uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.admin_users(id),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  reason        text not null check (char_length(reason) >= 20),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  constraint break_glass_expiry_after_start check (expires_at > created_at)
);
create index break_glass_grants_account_idx on public.break_glass_grants (account_id, expires_at desc);
alter table public.break_glass_grants enable row level security;
revoke all on public.break_glass_grants from anon, authenticated;

-- SPEC §30: fixed-window counters for per-account and per-IP rate limits.
create table public.rate_limit_counters (
  key          text not null,
  window_start timestamptz not null,
  count        integer not null check (count >= 0),
  primary key (key, window_start)
);
alter table public.rate_limit_counters enable row level security;
revoke all on public.rate_limit_counters from anon, authenticated;

-- SPEC §10, §31: account erasure. The account key can be destroyed (crypto-shred), like company keys.
alter table public.accounts
  add column purge_after timestamptz,
  add column purged_at   timestamptz;
alter table public.account_keys
  alter column wrapped_dek drop not null,
  add column destroyed_at timestamptz,
  add constraint account_keys_shred_is_real check ((destroyed_at is null) = (wrapped_dek is not null));

insert into public.app_config (key, value) values
  -- Daily gross margin estimate (SPEC §26). TODO(review): R-47 — payment gateway fee and infra cost.
  ('admin.payment_fee_percent', '"2.00"'::jsonb),
  ('admin.infra_cost_paise_per_day', '0'::jsonb),
  -- Break-glass grants last at most this long.
  ('admin.break_glass_max_minutes', '60'::jsonb),
  -- SPEC §30 rate limits, per minute. TODO(review): R-48 — tune from load tests.
  ('ratelimit.limits', '{"ai_per_account": 30, "chat_per_account": 12, "export_per_account": 3, "api_per_ip": 600}'::jsonb),
  -- SPEC §31: current versions of the legal documents a user accepts. TODO(review): R-11, R-12.
  ('legal.versions', '{"terms": "draft-2026-09", "privacy": "draft-2026-09", "processing": "draft-2026-09"}'::jsonb)
on conflict (key, version) do nothing;
