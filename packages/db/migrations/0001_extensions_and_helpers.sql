-- 0001: extensions, the app helper schema, and shared triggers.
--
-- The tenancy predicate (app.current_account_id / app.owns) is NOT here. Its body reads
-- public.accounts, and Postgres validates `language sql` bodies at creation time, so it
-- must be defined after 0002 creates that table. It lives at the end of 0002.

create extension if not exists "pgcrypto";

create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Shared triggers
-- ---------------------------------------------------------------------------

create or replace function app.touch_updated_at()
  returns trigger
  language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Refuses any UPDATE or DELETE. Attached to append-only tables so the guarantee holds
-- even for a superuser or a migration that forgets it, not only for the app role.
create or replace function app.forbid_mutation()
  returns trigger
  language plpgsql
as $$
begin
  raise exception
    'table %.% is append-only (SPEC §4); % is not permitted',
    tg_table_schema, tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

-- ---------------------------------------------------------------------------
-- Migration bookkeeping
-- ---------------------------------------------------------------------------

create table if not exists app.schema_migrations (
  version     text primary key,
  checksum    text not null,
  applied_at  timestamptz not null default now()
);

comment on table app.schema_migrations is
  'Applied migrations with a content checksum, so an edited-after-apply file is caught.';
