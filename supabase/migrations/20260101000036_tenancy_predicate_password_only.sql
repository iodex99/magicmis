-- GENERATED from packages/db/migrations/0036_tenancy_predicate_password_only.sql. Do not edit.
-- 0036: the database tenancy predicate catches up with password-only sign-in (ADR 0028).
--
-- Migration 0012 made `app.current_account_id()` require a JWT `aal` of 'aal2', because
-- SPEC §8 then read "the app is unusable until 2FA is enrolled". ADR 0028 removed the
-- customer's second factor, so every customer token is now aal1 and this clause rejected
-- all of them.
--
-- Nothing leaked: the predicate fails closed, and route handlers reach the database as
-- `service_role` (which bypasses RLS) with `requireAccount()` as the live gate. But the
-- two are meant to be redundant mirrors of one check, and a mirror that refuses everyone
-- is not redundancy -- it is a second layer that would never again catch a mistake in the
-- first. The remaining guard is the one ADR 0028 kept: the single active session.
--
-- The ADMIN console is untouched. Its operators still authenticate with TOTP against
-- `admin_users`, which this function has never been part of.

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
    -- SPEC §8: one active session; a new login terminates the previous one.
    and a.active_session_id is not null
    and a.active_session_id::text = coalesce(auth.jwt() ->> 'session_id', '')
  limit 1
$$;

comment on function app.current_account_id() is
  'Account id for the authenticated user on the active session, or NULL (SPEC §8, §9).';
