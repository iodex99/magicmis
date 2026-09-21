-- GENERATED from packages/db/migrations/0053_dashboard_layout_stage.sql. Do not edit.
-- 0053: routing for the stage that chooses a company's first dashboard (ADR 0056).
--
-- Every company used to get the same eight boxes. What a business is read by depends on what it
-- does, and its books already say which it is, so the boxes are chosen for it once, when the
-- dashboard is first built. A refresh never calls this: the recurring margin depends on a
-- monthly refresh making no AI calls at all, and this runs only where there is no dashboard yet.
--
-- The work is choosing a layout from a list of metric ids, not reading a file, so the efficient
-- and professional tiers route to the small model. Expert gets a larger one because a customer
-- who paid for it asked for more thought about which figures matter.
--
-- No prompt version is active for it yet (R-28), so the stage refuses until the owner runs its
-- evals, and the caller keeps the standard dashboard. That is the intended state, not a gap.
insert into public.tier_routing (tier, stage, model_id, effort, max_tokens, fallback_chain, prompt_version)
values
  ('efficient',    'dashboard_layout', 'claude-haiku-4-5-20251001', null,     6000,  '{}', null),
  ('professional', 'dashboard_layout', 'claude-sonnet-5',           'low',    8000,  '{claude-haiku-4-5-20251001}', null),
  ('expert',       'dashboard_layout', 'claude-opus-5',             'medium', 12000, '{claude-sonnet-5}', null)
on conflict (tier, stage, version) do nothing;
