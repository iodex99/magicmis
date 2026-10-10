-- 0082: Claude Opus 5.5 replaces Claude Opus 5 on every route (ADR 0088).
--
-- Verified 2026-10-10 against the official documentation:
--   https://platform.claude.com/docs/en/about-claude/models/overview
--   https://platform.claude.com/docs/en/about-claude/pricing
--   https://platform.claude.com/docs/en/models/opus-5-5/migration-guide
--   https://platform.claude.com/docs/en/build-with-claude/thinking
--
-- Model ID `claude-opus-5-5`: fixed, no date suffix, the same scheme as `claude-opus-5`.

-- 1. Opus 5.5 costs less than Opus 5 on every line: $4 input and $20 output per MTok (Opus 5:
--    $5 and $25), a 5-minute cache write at $5 (1.25×), a 1-hour write at $8 (2×), and cache
--    reads at $0.20, which is 0.05× the input price where every earlier model is 0.1×. The
--    Batch API's 50% applies. One price at every prompt length: no long-prompt band.
insert into public.model_registry
  (model_id, display_name_internal, input_price_per_mtok_micro_usd, output_price_per_mtok_micro_usd,
   cache_read_multiplier, cache_write_multiplier, cache_write_1h_multiplier, batch_discount,
   long_prompt_threshold_tokens, long_prompt_price_multiplier, available, source_url, verified_at)
values
  ('claude-opus-5-5', 'Claude Opus 5.5', 4000000, 20000000, 0.0500, 1.2500, 2.0000, 0.5000,
   null, null, true,
   'https://platform.claude.com/docs/en/about-claude/pricing', '2026-10-10T00:00:00Z')
on conflict (model_id, version) do nothing;

-- 2. Every route that names Opus 5 gets a new version naming Opus 5.5 — the eight Expert routes,
--    each with Opus 5 as its model and Sonnet 5 as its fallback.
--
--    - Effort and max_tokens are kept. Every route already sets its effort, so Opus 5.5's lower
--      default (`medium`, where Opus 5's is `high`) changes nothing, and Opus 5 already thought on
--      every request it did not force a tool on. Deep chat, the one route that forced a tool,
--      now chooses with `auto` (chat-deep.ts) and was measured at its ceiling before activation.
--    - prompt_version null. Activation matches an eval on the model in the route (as 0075 did
--      for Haiku 5.5), and none has run on Opus 5.5, so each stage refuses at Expert until
--      `go-live` records a passing live eval rather than running an unevaluated model on a
--      customer's books. Production starts with every route off anyway.
--    - A fallback naming Opus 5 is swapped in place and keeps its activation; there is none today.
--
--    Opus 5's registry row stays: every recorded call that used it is priced against it.
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
       case when model_id = 'claude-opus-5' then 'claude-opus-5-5' else model_id end,
       effort,
       max_tokens,
       array_replace(fallback_chain, 'claude-opus-5', 'claude-opus-5-5'),
       case when model_id = 'claude-opus-5' then null else prompt_version end,
       version + 1
  from latest
 where model_id = 'claude-opus-5'
    or 'claude-opus-5' = any (fallback_chain);
