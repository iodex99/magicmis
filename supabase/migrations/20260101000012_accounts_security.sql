-- GENERATED from packages/db/migrations/0012_accounts_security.sql. Do not edit.
-- 0012: accounts and security (SPEC §8, Phase 1; ADR 0009).
--
-- 1. The tenancy predicate now also requires a second factor (JWT `aal` = 'aal2') and the
--    account's single active session (JWT `session_id` = accounts.active_session_id).
--    Every tenant policy already calls app.owns(), so this one change makes the whole
--    schema unreadable to an aal1 token or a superseded session, even if a route handler
--    forgets its own check. Shipped as a new migration: 0002 is applied and immutable.
-- 2. Backup codes, re-auth grants and brute-force throttling, all service-role only.
-- 3. Default config for the above, in app_config (SPEC §0.5: no hardcoded numbers).

-- ---------------------------------------------------------------------------
-- Tenancy predicate: aal2 + active session
-- ---------------------------------------------------------------------------

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
    -- SPEC §8: "The app is unusable until 2FA is enrolled."
    and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    -- SPEC §8: one active session; a new login terminates the previous one.
    and a.active_session_id is not null
    and a.active_session_id::text = coalesce(auth.jwt() ->> 'session_id', '')
  limit 1
$$;

comment on function app.current_account_id() is
  'Account id for the authenticated user at aal2 on the active session, or NULL (SPEC §8, §9).';

-- The accounts policies from 0002 keyed off auth.uid() alone, so an aal1 token could read
-- its own profile row. Route them through the same predicate as everything else.
drop policy accounts_self_select on public.accounts;
drop policy accounts_self_update on public.accounts;

create policy accounts_self_select on public.accounts
  for select using (id = app.current_account_id());

-- ---------------------------------------------------------------------------
-- Login event types added by Phase 1
-- ---------------------------------------------------------------------------

alter table public.login_events drop constraint login_events_event_type_check;
alter table public.login_events add constraint login_events_event_type_check
  check (event_type in (
    'login', 'logout', 'failed', 'session_revoked',
    'mfa_enrolled', 'mfa_failed', 'mfa_reset_with_backup_code',
    'password_changed', 'email_changed',
    'backup_codes_regenerated', 'reauth', 'reauth_failed', 'locked_out'
  ));

alter table public.login_events add column new_device boolean not null default false;

create index login_events_device_idx
  on public.login_events (account_id, device_fingerprint_hash)
  where event_type = 'login';

-- ---------------------------------------------------------------------------
-- Backup codes (SPEC §8: 10 single-use codes, stored hashed)
-- ---------------------------------------------------------------------------

create table public.backup_codes (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  -- Regenerating creates a new generation and revokes the old one in the same transaction.
  generation  integer not null check (generation >= 1),
  -- `scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>`: the parameters travel with the hash, so
  -- they can be raised later without invalidating existing codes.
  code_hash   text not null,
  used_at     timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index backup_codes_live_idx
  on public.backup_codes (account_id)
  where used_at is null and revoked_at is null;

-- ---------------------------------------------------------------------------
-- Re-auth grants (SPEC §8: password + TOTP before sensitive actions)
-- ---------------------------------------------------------------------------

create table public.reauth_grants (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  -- Bound to one session. A grant earned in one tab is worthless to a stolen cookie
  -- from another session, and dies when that session is superseded.
  session_id  uuid not null,
  granted_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  consumed_at timestamptz,

  constraint reauth_grants_expiry_after_grant check (expires_at > granted_at)
);

create index reauth_grants_lookup_idx
  on public.reauth_grants (account_id, session_id, expires_at desc);

-- ---------------------------------------------------------------------------
-- Brute-force throttle (SPEC §8: rate limits and lockouts on auth endpoints)
-- ---------------------------------------------------------------------------

create table public.auth_throttle (
  -- e.g. 'reauth:account:<uuid>', 'backup_code:ip:<ip>'. Keys never contain a password,
  -- code or email address.
  key              text primary key,
  window_started_at timestamptz not null,
  attempts         integer not null default 0 check (attempts >= 0),
  locked_until     timestamptz,
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS and grants: service role only
-- ---------------------------------------------------------------------------

alter table public.backup_codes  enable row level security;
alter table public.reauth_grants enable row level security;
alter table public.auth_throttle enable row level security;

alter table public.backup_codes  force row level security;
alter table public.reauth_grants force row level security;
alter table public.auth_throttle force row level security;

revoke all on public.backup_codes  from anon, authenticated;
revoke all on public.reauth_grants from anon, authenticated;
revoke all on public.auth_throttle from anon, authenticated;

grant all on public.backup_codes, public.reauth_grants, public.auth_throttle to service_role;

-- ---------------------------------------------------------------------------
-- Config defaults (SPEC §0.5). Admin-editable; new versions supersede these rows.
-- ---------------------------------------------------------------------------

insert into public.app_config (key, value) values
  ('auth.backup_code_count', '10'::jsonb),
  ('auth.reauth_ttl_seconds', '600'::jsonb),
  ('auth.throttle', jsonb_build_object(
      'reauth',      jsonb_build_object('max_attempts', 5,  'window_seconds', 900,  'lockout_seconds', 1800),
      'backup_code', jsonb_build_object('max_attempts', 5,  'window_seconds', 900,  'lockout_seconds', 3600),
      'signup',      jsonb_build_object('max_attempts', 10, 'window_seconds', 3600, 'lockout_seconds', 3600)
  )),
  -- TODO(review): legal document versions are placeholders until R-10/R-11 are drafted.
  ('legal.document_versions', jsonb_build_object('terms', '0.1-draft', 'privacy', '0.1-draft', 'processing', '0.1-draft'))
on conflict (key, version) do nothing;
