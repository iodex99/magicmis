-- 0048: the margin report tells the truth about what a rupee costs to earn (ADR 0052).
--
-- Three seeded numbers were wrong or missing, and each of them flattered the margin the
-- owner reads. None of them changes what a customer pays; they change what we believe we
-- keep. All remain admin-editable (SPEC §0.5).

-- 1. Infrastructure had no cost at all, so the daily margin estimate was overstated by the
--    entire hosting bill. Hosting, database, worker, email and error tracking come to
--    roughly ₹7,500 a month at launch scale.
--    TODO(review): R-67 — set against the first real month of invoices.
insert into public.app_config (key, value, version)
select 'admin.infra_cost_paise_per_day', '25000'::jsonb, coalesce(max(version), 0) + 1
  from public.app_config where key = 'admin.infra_cost_paise_per_day'
on conflict (key, version) do nothing;

-- 2. One payment fee percentage for two currencies, and it left out the GST charged on the
--    fee itself. A domestic card costs about 2% plus 18% GST on that fee; an international
--    one costs about 3% plus the same GST. They are different numbers and must be held
--    separately, since the split between them is what the export push changes.
--    TODO(review): R-68 — confirm both against the live Razorpay rate card (R-26, R-60).
insert into public.app_config (key, value, version)
select 'admin.payment_fee_percent_by_currency',
       '{"INR": "2.36", "USD": "3.54"}'::jsonb,
       coalesce(max(version), 0) + 1
  from public.app_config where key = 'admin.payment_fee_percent_by_currency'
on conflict (key, version) do nothing;

-- The old single-rate key is left in place rather than deleted: nothing reads it after this
-- migration, and an operator who has edited it should still be able to see what it held.

-- 3. Commentary carried 149 base plus a 49 "instant surcharge". ADR 0050 removed the
--    delivery choice, so every run is instant and the surcharge is charged every time. The
--    price a customer pays is unchanged at 198; what changes is that the price book now
--    says so plainly instead of describing a discount nobody can choose.
insert into public.price_book
  (action_key, base_credits, tier_multipliers, instant_surcharge_credits, max_ai_cost_ratio,
   reservation_mode, price_from_action_key, version)
select 'commentary', 198, tier_multipliers, 0, max_ai_cost_ratio,
       reservation_mode, price_from_action_key, version + 1
  from public.price_book
 where action_key = 'commentary'
 order by version desc
 limit 1
on conflict (action_key, version) do nothing;
