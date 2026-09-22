-- "Where to act": suggestions a board can act on, from the company's own books (ADR 0062).
--
-- Commentary describes the month and its prompt forbids advice in as many words. This is the
-- other half — what to do about it — and it is a separate priced action because it is a separate
-- decision to buy, a separate AI call, and a document the board reads on its own.

-- 1. A job type, so it settles through the same machine every other paid action does: held on
-- confirm, captured on delivery, released on a platform fault.
alter table public.jobs drop constraint if exists jobs_type_check;
alter table public.jobs add constraint jobs_type_check check (type in (
  'data_diagnostic', 'company_setup', 'reference_mis_recreate',
  'monthly_refresh', 'refresh_with_restructure',
  'dashboard_addon', 'dashboard_refresh', 'commentary', 'board_actions'));

-- 2. The price. Shaped exactly like commentary, because it is the same size of job on the same
-- facts pack: one AI call over one month's figures. The surcharge stays OUTSIDE the tier
-- multiplier — migration 0048 folded commentary's in and moved two tiers out of three before
-- 0049 put it back (ADR 0053).
--
-- TODO(review): R-04/R-05 — the number is illustrative until the live evals (R-28) show what the
-- call actually costs. It is deliberately the same as commentary so the two can be compared.
insert into public.price_book
  (action_key, base_credits, tier_multipliers, instant_surcharge_credits, max_ai_cost_ratio,
   reservation_mode, price_from_action_key, enabled, version)
select 'board_actions', 149, tier_multipliers, 49, max_ai_cost_ratio,
       reservation_mode, null, true, 1
  from public.price_book
 where action_key = 'commentary'
 order by version desc
 limit 1
on conflict (action_key, version) do nothing;

-- 3. Routing. The work is judgement over a few hundred facts, not reading a file, so efficient
-- takes the small model and expert takes the large one — a customer who paid for expert asked
-- for more thought about what matters, which is the whole of this stage.
--
-- No prompt version is active (R-28), so the stage refuses until the owner runs its evals. The
-- caller checks that *before* holding any credits, so nobody is charged for a button that
-- cannot answer yet. That is the intended state, not a gap.
insert into public.tier_routing (tier, stage, model_id, effort, max_tokens, fallback_chain, prompt_version)
values
  ('efficient',    'board_actions', 'claude-haiku-4-5-20251001', null,     6000,  '{}', null),
  ('professional', 'board_actions', 'claude-sonnet-5',           'low',    10000, '{claude-haiku-4-5-20251001}', null),
  ('expert',       'board_actions', 'claude-opus-5',             'medium', 14000, '{claude-sonnet-5}', null)
on conflict (tier, stage, version) do nothing;
