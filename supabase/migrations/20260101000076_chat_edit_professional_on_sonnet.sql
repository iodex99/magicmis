-- GENERATED from packages/db/migrations/0076_chat_edit_professional_on_sonnet.sql. Do not edit.
-- 0076: Professional chat edits move from Haiku 5.5 to Sonnet 5 (ADR 0085).
--
-- Measured on 54 items on 2026-10-10, with the request now listing every box by position and
-- offering the analysis figures: Haiku 5.5 scored 0.9444 on prompt v3 and 0.9444 on v4, against a
-- 0.95 threshold. Its 0.9607 the day before, on 51 items and the older request, was the lucky side
-- of the same three misses. Sonnet 5 scored 0.9814 on v4 at Efficient and Expert on the same
-- dataset.
--
-- The threshold is not the thing to move (ADR 0066), and Professional is the tier most customers
-- use: a chat edit that lands on the wrong box changes a layout the company keeps for good (ADR
-- 0045). So the model moves, as migration 0061 moved Efficient chat edits off Haiku 4.5 for the
-- same reason. A chat edit is priced at 19 credits; on Sonnet it costs about one rupee of AI, near
-- 7%, inside the 20% cap. Haiku 5.5 stays as the fallback, so an outage degrades rather than fails.
--
-- Same model, effort and ceiling as Efficient and Expert. `prompt_version` is null: activation
-- matches an eval on the model in the route, and none is recorded for this pairing yet.
insert into public.tier_routing
  (tier, stage, model_id, effort, max_tokens, fallback_chain, prompt_version, version)
select 'professional', 'chat_edit', 'claude-sonnet-5', 'low', 2000,
       '{claude-haiku-5-5}', null, max(version) + 1
  from public.tier_routing
 where tier = 'professional' and stage = 'chat_edit';
