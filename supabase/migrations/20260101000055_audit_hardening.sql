-- GENERATED from packages/db/migrations/0055_audit_hardening.sql. Do not edit.
-- What the audit found in the schema (ADR 0057).

-- 1. An upload in flight now carries its own expiry, so a dropped connection cannot hold a
-- company's storage cap for ever. The period is config, like every other limit.
insert into public.app_config (key, value) values
  ('sources.incomplete_upload_hours', '6'::jsonb)
on conflict (key, version) do nothing;

-- 2. `source_upload_reads` is the evidence behind the promise that every opening of a customer's
-- file is on a record they can see (ADR 0047). It had the append-only trigger but not the revoke
-- that every other append-only table has, and TRUNCATE does not fire row triggers — so the one
-- role every server query runs as could erase the whole log in a single statement.
revoke update, delete, truncate on public.source_upload_reads from anon, authenticated, service_role;

-- 3. Migration 0052 refuses a price-book version that would come into force before an earlier
-- one, which is what makes ordering by version and ordering by date the same answer. It only
-- looked downwards: an update that pushed an *older* row's `effective_from` forward, past a
-- version above it, passed — and the two orders disagreed again. The trigger is the
-- defence-in-depth layer, so it gets the symmetric check too.
create or replace function app.price_book_version_order() returns trigger
  language plpgsql as $$
declare
  previous timestamptz;
  following timestamptz;
begin
  select max(effective_from) into previous
    from public.price_book
   where action_key = new.action_key and version < new.version;

  if previous is not null and new.effective_from < previous then
    raise exception
      'price_book: version % of % takes effect at %, before an earlier version does (%). A later version may not come into force earlier.',
      new.version, new.action_key, new.effective_from, previous;
  end if;

  select min(effective_from) into following
    from public.price_book
   where action_key = new.action_key and version > new.version;

  if following is not null and new.effective_from > following then
    raise exception
      'price_book: version % of % takes effect at %, after a later version does (%). A later version may not come into force earlier.',
      new.version, new.action_key, new.effective_from, following;
  end if;
  return new;
end;
$$;

comment on function app.price_book_version_order() is
  'Version order and date order are the same order, in both directions (ADR 0054, ADR 0057).';
