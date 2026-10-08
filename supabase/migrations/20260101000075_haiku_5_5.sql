-- GENERATED from packages/db/migrations/0075_haiku_5_5.sql. Do not edit.
-- 0075: Claude Haiku 5.5 replaces Claude Haiku 4.5 on every route (ADR 0083).
--
-- Verified 2026-10-08 against the official documentation:
--   https://platform.claude.com/docs/en/about-claude/models/overview
--   https://platform.claude.com/docs/en/models/haiku-5-5/overview
--   https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide
--   https://platform.claude.com/docs/en/about-claude/pricing
--   https://platform.claude.com/docs/en/build-with-claude/effort
--
-- Model ID `claude-haiku-5-5`: fixed, no date suffix, no separate alias. Released 2026-10-07.

-- 1. Haiku 5.5 is priced by prompt length. Up to 100,000 prompt tokens: $0.10 input, $0.50
--    output, $0.125 5-minute write, $0.20 1-hour write, $0.01 cache read per MTok. Over 100,000,
--    every one of those is exactly five times as much ($0.50, $2.50, $0.625, $1, $0.05), and the
--    Batch API's 50% applies to both bands. So the registry carries the band as a threshold and
--    one multiplier, null for a model with a single price. `costMicroUsd` counts the prompt as
--    everything sent — uncached input, cache writes and cache reads — which can only ever price a
--    call at the higher band, never the lower one by mistake.
alter table public.model_registry
  add column long_prompt_threshold_tokens integer
    check (long_prompt_threshold_tokens > 0),
  add column long_prompt_price_multiplier numeric(6,4)
    check (long_prompt_price_multiplier >= 1),
  add constraint model_registry_long_prompt_whole
    check ((long_prompt_threshold_tokens is null) = (long_prompt_price_multiplier is null));

insert into public.model_registry
  (model_id, display_name_internal, input_price_per_mtok_micro_usd, output_price_per_mtok_micro_usd,
   cache_read_multiplier, cache_write_multiplier, cache_write_1h_multiplier, batch_discount,
   long_prompt_threshold_tokens, long_prompt_price_multiplier, available, source_url, verified_at)
values
  ('claude-haiku-5-5', 'Claude Haiku 5.5', 100000, 500000, 0.1000, 1.2500, 2.0000, 0.5000,
   100000, 5.0000, true,
   'https://platform.claude.com/docs/en/about-claude/pricing', '2026-10-08T00:00:00Z')
on conflict (model_id, version) do nothing;

-- 2. Every route that names Haiku 4.5 gets a new version naming Haiku 5.5.
--
--    Where Haiku is the model the route runs:
--    - effort `low`. Haiku 5.5 thinks by default (adaptive, `medium`); Haiku 4.5 did not think at
--      all, and the migration guide's advice for a route that ran without thinking is a lower
--      effort, at which "it can skip thinking entirely on simpler requests". The effort page
--      recommends `low` for chat, short tasks and simple high-volume requests, which is what
--      every one of these stages is.
--    - max_tokens doubled. Thinking counts toward max_tokens, and the same text is about 30% more
--      tokens on the newer tokenizer, so a ceiling tuned for Haiku 4.5 "may cut off equivalent
--      output" (migration guide). A ceiling costs nothing until it is used, the runtime cap still
--      prices it at the full output rate, and at a tenth of Haiku 4.5's output price a doubled
--      ceiling is still a fifth of the old worst case. R-09 tunes it from the first evals.
--    - prompt_version null. Activation matches an eval on the model in the route (activation.ts;
--      the same rule migrations 0061 and 0063 followed), and no eval has run on Haiku 5.5, so the
--      stage refuses until `go-live` records one rather than running an unevaluated model on a
--      customer's books. Production starts with every route off anyway.
--
--    Where Haiku is only the fallback, it is swapped in place and the route keeps its activation:
--    activation was never measured on the fallback, Haiku 4.5 included.
with latest as (
  select distinct on (tier, stage) tier, stage, model_id, effort, max_tokens, fallback_chain,
         prompt_version, version
    from public.tier_routing
   order by tier, stage, version desc
)
insert into public.tier_routing
  (tier, stage, model_id, effort, max_tokens, fallback_chain, prompt_version, version)
select tier,
       stage,
       case when model_id = 'claude-haiku-4-5-20251001' then 'claude-haiku-5-5' else model_id end,
       case when model_id = 'claude-haiku-4-5-20251001' then 'low' else effort end,
       case when model_id = 'claude-haiku-4-5-20251001' then max_tokens * 2 else max_tokens end,
       array_replace(fallback_chain, 'claude-haiku-4-5-20251001', 'claude-haiku-5-5'),
       case when model_id = 'claude-haiku-4-5-20251001' then null else prompt_version end,
       version + 1
  from latest
 where model_id = 'claude-haiku-4-5-20251001'
    or 'claude-haiku-4-5-20251001' = any (fallback_chain);

-- 3. The job estimator's characters per token for sheet recognition (R-30). Its 2.76 was measured
--    on recordings made almost entirely on Haiku 4.5's older tokenizer; the same text is about
--    30% more tokens on Haiku 5.5, and 2.76 / 1.30 = 2.12, rounded down as 0073 rounds every
--    figure so none is under-counted. The other measured stages already ran mostly on the newer
--    tokenizer (Sonnet 5 and Opus 5) and are left alone. Re-measure from the first Haiku 5.5
--    recordings. Merged into the current value, so an operator's later setting is kept.
insert into public.app_config (key, value, version)
select 'ai.estimator',
       jsonb_set(
         (select value from public.app_config where key = 'ai.estimator'
           order by version desc limit 1),
         '{chars_per_token_by_stage,sheet_classification}',
         '"2.1"'::jsonb
       ),
       coalesce(max(version), 0) + 1
  from public.app_config where key = 'ai.estimator';
