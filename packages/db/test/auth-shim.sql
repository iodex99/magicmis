-- Test-only Supabase auth shim.
--
-- Supabase provides an `auth` schema whose `auth.uid()` the RLS policies call. Plain
-- Postgres does not, so the policies would fail to compile in a Testcontainers database.
--
-- Fidelity matters here more than anywhere else in the test suite: if this diverges from
-- the real function, the RLS harness proves something about the shim rather than about
-- production. So it reproduces the documented behaviour and nothing more.
--
-- Verified 2026-09-11:
--   * auth.uid() "Returns the ID of the user making the request", and returns NULL when
--     there is no authenticated user.
--     https://supabase.com/docs/guides/database/postgres/row-level-security
--   * Claims reach SQL through PostgREST's transaction-scoped `request.jwt.claims`
--     setting, read as current_setting('request.jwt.claims', true)::json->>'sub'.
--     https://docs.postgrest.org/en/stable/references/transactions.html
--
-- Supabase does not publish auth.uid()'s SQL definition, so the body below is the
-- documented contract implemented over the documented claims mechanism, not a copy of
-- their source. It is deliberately the only function defined here: an earlier draft also
-- defined auth.role(), which is NOT a documented Supabase function and which nothing in
-- the migrations uses. Inventing helpers in a fidelity shim is how it starts to drift.
--
-- Applied ONLY by the test harness, never by a migration, so it cannot reach a real
-- Supabase database and shadow the genuine function.

create schema if not exists auth;

create or replace function auth.uid()
  returns uuid
  language sql
  stable
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::json ->> 'sub',
    ''
  )::uuid
$$;
