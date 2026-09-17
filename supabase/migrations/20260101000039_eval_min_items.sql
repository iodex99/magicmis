-- GENERATED from packages/db/migrations/0039_eval_min_items.sql. Do not edit.
-- 0039: an eval score only counts over enough examples (SPEC §14, R-28).
--
-- Activation compared the latest live eval's accuracy to a threshold and nothing else. A
-- three-item smoke test that scores 3/3 is "100%" and would have cleared every threshold,
-- although it proves only that the harness can reach the API. The floor makes a switch-on
-- rest on a real sample.
--
-- TODO(review): R-28 — 50 is a starting floor, tuned alongside ai.eval_thresholds.

insert into public.app_config (key, value) values
  ('ai.eval_min_items', '50'::jsonb)
on conflict (key, version) do nothing;
