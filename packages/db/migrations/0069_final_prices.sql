-- 0069: the final prices (R-04, R-05, ADR 0075).
--
-- The price book in credits is confirmed as it stands, and so are the rupee packs: a credit is
-- ₹1 ex-GST by locked decision 4, so a rupee pack is its credits in rupees and there is nothing
-- to choose. What moves is the dollar price of each pack. The revenue is expected from the
-- United States, the United Kingdom and Europe (ADR 0074), where the seeded dollar prices put a
-- company's month at a fraction of what the market pays for less, and a credit is sold per
-- currency, never converted (ADR 0030), so this is the one lever that raises what the West
-- pays without touching an Indian customer.
--
--   pack       credits + bonus     was      now    per credit
--   Starter      2,000 +      0      $29      $49    $0.0245
--   Plus         5,000 +    250      $69     $109    $0.0208
--   Growth      10,000 +    750     $129     $199    $0.0185
--   Practice    25,000 +  2,500     $299     $449    $0.0163
--   Firm        50,000 +  6,000     $579     $849    $0.0152
--   Scale      100,000 + 15,000   $1,099   $1,549    $0.0135
--
-- Packs are never edited (apps/admin/src/server/catalog.ts): each seeded pack is deactivated
-- and replaced by a new version with the same name, credits, bonus, order and rupee price, and
-- the new dollar price. A purchase snapshots its pack, so one already under way is unaffected.
-- Only a pack still at its seeded dollar price is replaced, so an operator's own price is kept.

create temporary table final_usd (credits bigint primary key, seeded bigint, final bigint);

insert into final_usd (credits, seeded, final) values
  (  2000,   2900,   4900),
  (  5000,   6900,  10900),
  ( 10000,  12900,  19900),
  ( 25000,  29900,  44900),
  ( 50000,  57900,  84900),
  (100000, 109900, 154900);

create temporary table replaced (old_id uuid, new_id uuid, credits bigint);

insert into replaced (old_id, credits)
select p.id, p.credits_granted
  from public.credit_packs p
  join public.credit_pack_prices usd on usd.pack_id = p.id and usd.currency = 'USD'
  join final_usd f on f.credits = p.credits_granted and f.seeded = usd.price_minor_ex_tax
 where p.active;

update replaced r
   set new_id = gen_random_uuid();

insert into public.credit_packs
  (id, name, credits_granted, bonus_credits, active, sort_order, version)
select r.new_id, p.name, p.credits_granted, p.bonus_credits, true, p.sort_order, p.version + 1
  from replaced r
  join public.credit_packs p on p.id = r.old_id;

insert into public.credit_pack_prices (pack_id, currency, price_minor_ex_tax)
select r.new_id, 'INR', inr.price_minor_ex_tax
  from replaced r
  join public.credit_pack_prices inr on inr.pack_id = r.old_id and inr.currency = 'INR';

insert into public.credit_pack_prices (pack_id, currency, price_minor_ex_tax)
select r.new_id, 'USD', f.final
  from replaced r
  join final_usd f on f.credits = r.credits;

update public.credit_packs p
   set active = false
  from replaced r
 where p.id = r.old_id;

drop table replaced;
drop table final_usd;
