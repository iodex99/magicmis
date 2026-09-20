-- GENERATED from packages/db/migrations/0049_commentary_price_restored.sql. Do not edit.
-- 0049: undo 0048's commentary price change, which was wrong on two tiers out of three.
--
-- 0048 folded commentary's 49-credit instant surcharge into its base, claiming the customer
-- would pay exactly what they paid before. That was true only at the professional tier.
-- `computePrice` (packages/wallet/src/pricing.ts) is
--
--     round(base_credits × tier_multiplier + instant_surcharge_credits)
--
-- so the surcharge is added AFTER the multiplier and is deliberately not scaled by it. Moving
-- it into the base puts it through the multiplier:
--
--     tier          before 0048          after 0048        delta
--     efficient     149×0.8 + 49 = 168   198×0.8 = 158     −10 credits
--     professional  149×1.0 + 49 = 198   198×1.0 = 198       0
--     expert        149×2.5 + 49 = 422   198×2.5 = 495     +73 credits, +17.3%
--
-- Expert commentary was silently overcharged and efficient undercharged, and each tier's AI
-- cost cap moved with its price. There is no base that reproduces all three prices, so the
-- fold cannot be done at all: version 3 restores version 1's numbers exactly.
--
-- What 0048 was actually trying to fix — that nobody can choose the cheaper delivery any more,
-- so the surcharge is charged every time — is fixed where it belongs, by taking `delivery` out
-- of the browser's hands (ADR 0053). The price book keeps the mechanism; the server alone picks
-- the mode.
--
-- `enabled` is carried forward from the current row rather than left to its default, which 0048
-- also got wrong: it would have silently re-enabled commentary for an operator who disabled it.
insert into public.price_book
  (action_key, base_credits, tier_multipliers, instant_surcharge_credits, max_ai_cost_ratio,
   reservation_mode, price_from_action_key, enabled, version)
select 'commentary', 149, tier_multipliers, 49, max_ai_cost_ratio,
       reservation_mode, price_from_action_key, enabled, version + 1
  from public.price_book
 where action_key = 'commentary'
 order by version desc
 limit 1
on conflict (action_key, version) do nothing;
