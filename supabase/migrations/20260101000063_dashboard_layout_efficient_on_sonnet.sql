-- The Efficient tier's first dashboard moves from Haiku 4.5 to Sonnet 5 (R-28, ADR 0066).
--
-- With the length bug fixed and prompt v2 in place, Haiku reached 0.9473 on 57 items against a
-- 0.95 threshold, while Sonnet and Opus both scored 1.000 on the same dataset. The gap is not
-- noise and it is not the prompt: Haiku puts metrics on the board that the company does not
-- hold — usually a percentage whose components are present but whose own value is null — and a
-- box like that shows a dash every month, which is exactly what ADR 0056 added the check to
-- prevent. It also needed the repair round on 37 of 57 first attempts, so two thirds of
-- Efficient-tier boards were costing two model calls rather than one.
--
-- The threshold is not the thing to move. 0.95 was reasoned rather than measured and is still
-- marked for review, but 0.9473 clears 0.94 by four items in fifty-seven, which is inside the
-- noise of this sample; passing a stage on that would be choosing the bar to fit the score.
--
-- What moves is the model, and this stage is the cheapest possible place to do it:
-- `dashboard_layout` runs **once per company, ever** — only where there is no dashboard yet, so
-- a monthly refresh still makes no AI call at all (§2, the recurring-margin rule). Measured cost
-- is ₹0.36 a call on Haiku against ₹1.74 on Sonnet, but Haiku's repair round puts its effective
-- cost near ₹0.59, so the real one-time difference is around ₹1.15 on an action priced in the
-- hundreds of credits. The alternative was leaving every Efficient-tier company on the standard
-- eight boxes for the sake of about a rupee, once.
--
-- Same shape as migration 0061, which moved `chat_edit` for the same reason.
--
-- `prompt_version` is deliberately null. Activation matches an eval on the model in the route
-- (packages/ai/src/activation.ts), so this pairing has no passing eval until one is recorded;
-- until then the stage keeps DEFAULT_DASHBOARD rather than running an unevaluated model.
insert into public.tier_routing
  (tier, stage, model_id, effort, max_tokens, fallback_chain, prompt_version, version)
select 'efficient', 'dashboard_layout', 'claude-sonnet-5', 'low', 8000,
       '{claude-haiku-4-5-20251001}', null, max(version) + 1
  from public.tier_routing
 where tier = 'efficient' and stage = 'dashboard_layout';
