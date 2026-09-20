-- 0052: a later price-book version can never come into force earlier (ADR 0054, closes R-76).
--
-- `priceBookEntry` picks the price in force with `where effective_from <= now order by version
-- desc limit 1` — by version, not by date. An audit asked whether that is right, since a
-- correction entered with a later `effective_from` but a lower version number would be ignored.
--
-- Ordering by date instead was tried and reverted: it moves live prices for a narrow benefit,
-- and it breaks on seeded rows, which carry the migration's own timestamp and so beat anything
-- deliberately back-dated.
--
-- The real problem was not which column to order by. It was that the two could disagree at all.
-- Every writer allocates `max(version) + 1`, so versions are already in the order the edits were
-- made; this makes the dates agree with them. With the invariant enforced, ordering by version
-- and ordering by date give the same row, always, and the question stops being a question.
create or replace function app.price_book_version_order() returns trigger
  language plpgsql as $$
declare
  previous timestamptz;
begin
  select max(effective_from) into previous
    from public.price_book
   where action_key = new.action_key and version < new.version;

  if previous is not null and new.effective_from < previous then
    raise exception
      'price_book: version % of % takes effect at %, before an earlier version does (%). A later version may not come into force earlier.',
      new.version, new.action_key, new.effective_from, previous;
  end if;
  return new;
end;
$$;

create trigger price_book_version_order
  before insert or update on public.price_book
  for each row execute function app.price_book_version_order();
