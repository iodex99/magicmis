-- GENERATED from packages/db/migrations/0011_roles_and_grants.sql. Do not edit.
-- 0011: application role and grants.
--
-- SPEC §9: credit_ledger and audit_log are append-only with "no UPDATE or DELETE grants
-- at the database role level". The triggers in 0006 and 0009 already refuse those
-- operations; this migration removes the privilege as well, so the guarantee holds at
-- two independent layers. A trigger can be dropped by a migration; a missing grant
-- shows up as a permission error rather than silent data loss.

-- On Supabase these roles already exist. Locally they do not, so create them if absent.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema app to authenticated, service_role;

-- Customer-facing roles read through RLS and never write directly: every mutation goes
-- through a server route running as service_role inside a locked transaction.
grant select on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- The append-only guarantee, as a privilege.
revoke update, delete, truncate on public.credit_ledger from anon, authenticated, service_role;
revoke update, delete, truncate on public.audit_log     from anon, authenticated, service_role;
revoke update, delete, truncate on public.blueprints    from anon, authenticated, service_role;
revoke update, delete, truncate on public.snapshots     from anon, authenticated, service_role;
revoke update, delete, truncate on public.invoices      from anon, authenticated, service_role;

-- Wrapped DEKs and the redaction key are never readable by a customer-facing role,
-- policy or no policy.
revoke all on public.account_keys from anon, authenticated;
revoke all on public.company_keys from anon, authenticated;

-- Internal cost and routing tables: SPEC §2.5 says users never see model names or AI cost.
revoke all on public.model_registry        from anon, authenticated;
revoke all on public.tier_routing          from anon, authenticated;
revoke all on public.ai_calls              from anon, authenticated;
revoke all on public.estimator_calibration from anon, authenticated;
revoke all on public.app_config            from anon, authenticated;
revoke all on public.job_stage_outputs     from anon, authenticated;
revoke all on public.chat_query_steps      from anon, authenticated;
revoke all on public.library_candidates    from anon, authenticated;
revoke all on public.invoice_counters      from anon, authenticated;
-- audit_log records admin actions and system events across every tenant. It has no
-- customer policy, so RLS already returns nothing -- but relying on "no policy" alone
-- means a future policy added for one purpose silently opens it for all (SPEC §30).
revoke all on public.audit_log             from anon, authenticated;

-- anon is pre-authentication. It sees the public price book and packs and nothing else;
-- SPEC §2.3 makes viewing those uncharged, and everything else requires a login.
revoke all on all tables in schema public from anon;
grant select on public.price_book   to anon;
grant select on public.credit_packs to anon;
grant select on public.mis_heads    to anon;

alter default privileges in schema public
  grant select on tables to authenticated;
alter default privileges in schema public
  grant all on tables to service_role;
