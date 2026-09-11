-- 0002: accounts, login events, consents, account keys (SPEC §8, §9).
--
-- SPEC §2.2: one login per account. There are no user-to-user relationships anywhere in
-- this schema -- no teams, roles, invitations, orgs or sub-users. Do not add a join
-- table that implies one.

create table public.accounts (
  id                uuid primary key default gen_random_uuid(),
  auth_user_id      uuid not null unique,
  email             text not null,
  business_name     text not null,
  gstin             text,
  billing_address   jsonb not null default '{}'::jsonb,
  state_code        text not null,
  status            text not null default 'active'
                      check (status in ('active', 'suspended', 'deleted')),
  -- SPEC §8: a new login revokes all other sessions. Every authenticated request
  -- verifies it holds the active one.
  active_session_id uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,

  -- Shape only. The checksum is validated in application code (packages/core), which
  -- can explain *why* a GSTIN is rejected; a CHECK constraint can only refuse it.
  constraint accounts_gstin_shape
    check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$'),
  constraint accounts_state_code_shape check (state_code ~ '^[0-9]{2}$')
);

create unique index accounts_email_active_idx
  on public.accounts (lower(email)) where deleted_at is null;

create trigger accounts_touch before update on public.accounts
  for each row execute function app.touch_updated_at();

-- SPEC §8: login time, IP, approximate location, user agent. A new device emails an alert.
create table public.login_events (
  id                      uuid primary key default gen_random_uuid(),
  account_id              uuid not null references public.accounts(id) on delete cascade,
  event_type              text not null
                            check (event_type in ('login', 'logout', 'failed', 'session_revoked',
                                                  'mfa_enrolled', 'mfa_failed', 'password_changed',
                                                  'email_changed', 'backup_codes_regenerated')),
  ip                      inet,
  geo                     jsonb,
  user_agent              text,
  device_fingerprint_hash text,
  created_at              timestamptz not null default now()
);

create index login_events_account_time_idx
  on public.login_events (account_id, created_at desc);

-- SPEC §8: each acceptance recorded with version and timestamp.
create table public.consents (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  document    text not null check (document in ('terms', 'privacy', 'processing')),
  version     text not null,
  accepted_at timestamptz not null default now(),
  ip          inet
);

create index consents_account_idx on public.consents (account_id, document, accepted_at desc);

-- SPEC §10: envelope encryption. The DEK is stored wrapped; the master key lives in KMS.
create table public.account_keys (
  account_id      uuid primary key references public.accounts(id) on delete cascade,
  wrapped_dek     bytea not null,
  kms_key_version text not null,
  created_at      timestamptz not null default now(),
  rotated_at      timestamptz
);

-- ---------------------------------------------------------------------------
-- Tenancy predicate
-- ---------------------------------------------------------------------------
--
-- SPEC §9: every customer table carries account_id and has an RLS policy restricting
-- rows to the authenticated account. Both functions below are the single place that
-- decides tenancy, so every policy in every later migration is one call to app.owns().
--
-- Defined here rather than in 0001 because the body reads public.accounts, and Postgres
-- parses `language sql` bodies when the function is created.

-- The account id for the current request, or NULL when unauthenticated.
--
-- SECURITY DEFINER is load-bearing: without it, reading public.accounts from inside a
-- policy on public.accounts recurses. STABLE lets the planner call it once per query
-- rather than once per row.
--
-- search_path is pinned empty and every name fully qualified, so a caller cannot shadow
-- `accounts` with a temp table and impersonate another tenant. There is a test for that.
create or replace function app.current_account_id()
  returns uuid
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select a.id
  from public.accounts a
  where a.auth_user_id = auth.uid()
    and a.deleted_at is null
    and a.status = 'active'
  limit 1
$$;

comment on function app.current_account_id() is
  'Account id for the authenticated user, or NULL. The single tenancy predicate (SPEC §9).';

-- Read by every customer-table policy.
create or replace function app.owns(row_account_id uuid)
  returns boolean
  language sql
  stable
as $$
  select row_account_id is not null
     and row_account_id = app.current_account_id()
$$;

comment on function app.owns(uuid) is
  'True when the row belongs to the authenticated account. A NULL account_id never matches.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.accounts      enable row level security;
alter table public.login_events  enable row level security;
alter table public.consents      enable row level security;
alter table public.account_keys  enable row level security;

alter table public.accounts      force row level security;
alter table public.login_events  force row level security;
alter table public.consents      force row level security;
alter table public.account_keys  force row level security;

-- accounts keys off auth.uid() directly rather than app.current_account_id(), which
-- would be circular.
create policy accounts_self_select on public.accounts
  for select using (auth_user_id = auth.uid() and deleted_at is null);

create policy accounts_self_update on public.accounts
  for update using (auth_user_id = auth.uid() and deleted_at is null)
             with check (auth_user_id = auth.uid());

create policy login_events_own on public.login_events
  for select using (app.owns(account_id));

create policy consents_own on public.consents
  for select using (app.owns(account_id));

-- No policy on account_keys: wrapped DEKs are reachable only by the service role,
-- which bypasses RLS. RLS is still forced so a leaked anon key reads nothing.
