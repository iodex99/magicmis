-- GENERATED from packages/db/migrations/0083_sonnet_5_5.sql. Do not edit.
-- 0083: Claude Sonnet 5.5 replaces Claude Sonnet 5 on every route (ADR 0089).
--
-- Verified 2026-10-10 against the official documentation:
--   https://platform.claude.com/docs/en/about-claude/models/overview
--   https://platform.claude.com/docs/en/about-claude/pricing
--   https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide
--
-- Model ID `claude-sonnet-5-5`: fixed, no date suffix.

-- 1. The same input and output price as Sonnet 5 — $2 and $10 per MTok — with a 5-minute cache
--    write at $2.50 (1.25×), a 1-hour write at $4 (2×), and cache reads at $0.10, which is 0.05×
--    the input price where Sonnet 5's is 0.1×. The Batch API's 50% applies. One price at every
--    prompt length.
insert into public.model_registry
  (model_id, display_name_internal, input_price_per_mtok_micro_usd, output_price_per_mtok_micro_usd,
   cache_read_multiplier, cache_write_multiplier, cache_write_1h_multiplier, batch_discount,
   long_prompt_threshold_tokens, long_prompt_price_multiplier, available, source_url, verified_at)
values
  ('claude-sonnet-5-5', 'Claude Sonnet 5.5', 2000000, 10000000, 0.0500, 1.2500, 2.0000, 0.5000,
   null, null, true,
   'https://platform.claude.com/docs/en/about-claude/pricing', '2026-10-10T00:00:00Z')
on conflict (model_id, version) do nothing;

-- 2. Every route that names Sonnet 5 gets a new version naming Sonnet 5.5: seventeen as the
--    model, on every tier, and the eight Expert routes that keep it as their fallback.
--
--    Where it is the model, effort and max_tokens are kept and activation is cleared, exactly as
--    0082 did for Opus 5.5: each route sets its effort, the stage refuses until `go-live` records
--    a passing live eval on the new model, and Sonnet 5.5's own breaking change — it refuses a
--    forced tool call — is met in chat-deep.ts. Where it is only the fallback it is swapped in
--    place, and the route keeps its activation.
--
--    Sonnet 5's registry row stays: every recorded call that used it is priced against it.
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
       case when model_id = 'claude-sonnet-5' then 'claude-sonnet-5-5' else model_id end,
       effort,
       max_tokens,
       array_replace(fallback_chain, 'claude-sonnet-5', 'claude-sonnet-5-5'),
       case when model_id = 'claude-sonnet-5' then null else prompt_version end,
       version + 1
  from latest
 where model_id = 'claude-sonnet-5'
    or 'claude-sonnet-5' = any (fallback_chain);
