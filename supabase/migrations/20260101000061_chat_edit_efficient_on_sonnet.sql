-- GENERATED from packages/db/migrations/0061_chat_edit_efficient_on_sonnet.sql. Do not edit.
-- Efficient chat edits move from Haiku 4.5 to Sonnet 5 (R-28).
--
-- The first live evals put Haiku at 0.9411 on chat_edit against a 0.95 threshold, twice, on the
-- same 51 items — reproducible, not noise. Sonnet scored 0.9803 on the same prompt and dataset.
--
-- A threshold is not the thing to move here. A wrong pointer edits the wrong box on a layout the
-- company keeps for good (ADR 0045); Undo exists, but the damage is seen first. What moves is the
-- model: chat_edit is a 21-credit action whose measured AI cost on Haiku was ₹0.09, so the whole
-- Efficient tier of this one action gets better at a cost that stays far inside the 20% cap. The
-- alternative was leaving Build unavailable to anyone on the cheapest tier, which is a worse
-- product for the sake of a cheaper token.
--
-- Efficient now matches what Expert already runs — same model, same effort, same ceiling — with
-- Haiku kept as the fallback so a model outage degrades rather than fails.
--
-- `prompt_version` is deliberately null. Activation matches an eval on the model in the route
-- (packages/ai/src/activation.ts), so this pairing has no passing eval until one is recorded;
-- until then the stage refuses rather than running an unevaluated model on a customer's board.
insert into public.tier_routing
  (tier, stage, model_id, effort, max_tokens, fallback_chain, prompt_version, version)
select 'efficient', 'chat_edit', 'claude-sonnet-5', 'low', 2000,
       '{claude-haiku-4-5-20251001}', null, max(version) + 1
  from public.tier_routing
 where tier = 'efficient' and stage = 'chat_edit';
