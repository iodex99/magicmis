-- Test-only Supabase auth shim.
--
-- Supabase provides an `auth` schema whose `auth.uid()` reads the verified JWT claims
-- set on the connection. Plain Postgres does not, so the RLS policies would fail to
-- compile in a Testcontainers database.
--
-- This reproduces the documented contract exactly -- `auth.uid()` returns the `sub`
-- claim from `request.jwt.claims` as a uuid, or NULL when unset -- and nothing else.
-- It is applied ONLY by the test harness, never by a migration, so it cannot reach a
-- real Supabase database and shadow the genuine function.
--
-- Keeping the shim minimal and identical in contract is what makes the RLS harness
-- meaningful: if it diverged, the tests would be proving something about the shim.

create schema if not exists auth;

create or replace function auth.uid()
  returns uuid
  language sql
  stable
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
    ''
  )::uuid
$$;

create or replace function auth.role()
  returns text
  language sql
  stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'role', ''),
    'anon'
  )
$$;
