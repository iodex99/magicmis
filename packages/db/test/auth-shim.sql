-- Test-only Supabase auth shim.
--
-- Supabase provides an `auth` schema whose functions the RLS policies call. Plain
-- Postgres does not, so the policies would fail to compile in a Testcontainers database.
--
-- Fidelity matters here more than anywhere else in the test suite: if this diverges from
-- the real functions, the RLS harness proves something about the shim rather than about
-- production.
--
-- PARITY CHECKED 2026-09-13 against a running Supabase local stack (CLI 2.117.0,
-- public.ecr.aws/supabase/postgres:17.6.1.167) using pg_get_functiondef. The bodies below
-- are copied from that output, not reconstructed from documentation.
--
-- The check found one real divergence in the earlier, documentation-derived shim: with no
-- claims set, the real auth.jwt() returns NULL, while the shim returned '{}'. Every policy
-- here reads claims through coalesce(), so no test outcome changed, but a future policy
-- written as `auth.jwt() ->> 'x' is null` would have behaved differently under test than
-- in production. The real functions also fall back to the legacy single-claim settings
-- (`request.jwt.claim.sub`, `request.jwt.claim`), which the shim now reproduces.
--
-- Applied ONLY by the test harness, never by a migration, so it cannot reach a real
-- Supabase database and shadow the genuine functions.

create schema if not exists auth;

create or replace function auth.uid()
  returns uuid
  language sql
  stable
as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.jwt()
  returns jsonb
  language sql
  stable
as $$
  select
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;
