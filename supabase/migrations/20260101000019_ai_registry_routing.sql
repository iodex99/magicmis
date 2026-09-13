-- GENERATED from packages/db/migrations/0019_ai_registry_routing.sql. Do not edit.
-- Phase 4 (SPEC §14, §26): verified model registry, default tier routing, AI config, prompt eval
-- records and margin events. Prices verified 2026-09-13 against
-- https://platform.claude.com/docs/en/about-claude/pricing (ADR 0019).

-- 1-hour cache writes are billed at 2x base input (5-minute writes at 1.25x, cache_write_multiplier).
alter table public.model_registry
  add column cache_write_1h_multiplier numeric(6,4) not null default 2.0000
    check (cache_write_1h_multiplier >= 0);

insert into public.model_registry
  (model_id, display_name_internal, input_price_per_mtok_micro_usd, output_price_per_mtok_micro_usd,
   cache_read_multiplier, cache_write_multiplier, batch_discount, available, source_url, verified_at)
values
  ('claude-haiku-4-5-20251001', 'Claude Haiku 4.5', 1000000, 5000000, 0.1000, 1.2500, 0.5000, true,
   'https://platform.claude.com/docs/en/about-claude/pricing', '2026-09-13T00:00:00Z'),
  ('claude-sonnet-5', 'Claude Sonnet 5', 2000000, 10000000, 0.1000, 1.2500, 0.5000, true,
   'https://platform.claude.com/docs/en/about-claude/pricing', '2026-09-13T00:00:00Z'),
  ('claude-opus-5', 'Claude Opus 5', 5000000, 25000000, 0.1000, 1.2500, 0.5000, true,
   'https://platform.claude.com/docs/en/about-claude/pricing', '2026-09-13T00:00:00Z'),
  -- SPEC §2.10: Expert+ is admin-quote only and disabled by default.
  ('claude-fable-5-1', 'Claude Fable 5.1', 10000000, 50000000, 0.0250, 1.2500, 0.5000, false,
   'https://platform.claude.com/docs/en/about-claude/pricing', '2026-09-13T00:00:00Z')
on conflict (model_id, version) do nothing;

-- Which prompt version a route runs; null means the stage is not activated. Activation requires
-- recorded eval results meeting ai.eval_thresholds (packages/ai activation.ts, SPEC §14).
alter table public.tier_routing add column prompt_version integer;

-- SPEC §14 default routing. Effort is omitted (null) for Haiku 4.5, which does not support it.
-- max_tokens bounds thinking plus output. TODO(review): R-09 — tune effort and max_tokens from evals.
insert into public.tier_routing (tier, stage, model_id, effort, max_tokens, fallback_chain, prompt_version) values
  ('efficient',    'sheet_classification', 'claude-haiku-4-5-20251001', null,     4000,  '{}', null),
  ('professional', 'sheet_classification', 'claude-haiku-4-5-20251001', null,     4000,  '{}', null),
  ('expert',       'sheet_classification', 'claude-sonnet-5',           'low',    8000,  '{claude-haiku-4-5-20251001}', null),
  ('efficient',    'column_mapping',       'claude-haiku-4-5-20251001', null,     8000,  '{}', null),
  ('professional', 'column_mapping',       'claude-sonnet-5',           'low',    12000, '{claude-haiku-4-5-20251001}', null),
  ('expert',       'column_mapping',       'claude-opus-5',             'low',    16000, '{claude-sonnet-5}', null),
  ('efficient',    'ledger_mapping',       'claude-sonnet-5',           'medium', 16000, '{claude-haiku-4-5-20251001}', null),
  ('professional', 'ledger_mapping',       'claude-sonnet-5',           'medium', 16000, '{claude-haiku-4-5-20251001}', null),
  ('expert',       'ledger_mapping',       'claude-opus-5',             'medium', 24000, '{claude-sonnet-5}', null),
  ('efficient',    'reference_layout',     'claude-sonnet-5',           'medium', 16000, '{}', null),
  ('professional', 'reference_layout',     'claude-sonnet-5',           'medium', 16000, '{}', null),
  ('expert',       'reference_layout',     'claude-opus-5',             'medium', 24000, '{claude-sonnet-5}', null),
  ('efficient',    'commentary',           'claude-sonnet-5',           'medium', 16000, '{}', null),
  ('professional', 'commentary',           'claude-sonnet-5',           'medium', 16000, '{}', null),
  ('expert',       'commentary',           'claude-opus-5',             'medium', 24000, '{claude-sonnet-5}', null),
  ('efficient',    'chat_quick',           'claude-haiku-4-5-20251001', null,     4000,  '{}', null),
  ('professional', 'chat_quick',           'claude-sonnet-5',           'low',    8000,  '{claude-haiku-4-5-20251001}', null),
  ('expert',       'chat_quick',           'claude-opus-5',             'low',    8000,  '{claude-sonnet-5}', null),
  ('efficient',    'chat_deep',            'claude-sonnet-5',           'medium', 12000, '{}', null),
  ('professional', 'chat_deep',            'claude-sonnet-5',           'medium', 12000, '{}', null),
  ('expert',       'chat_deep',            'claude-opus-5',             'medium', 16000, '{claude-sonnet-5}', null),
  ('efficient',    'chat_edit',            'claude-haiku-4-5-20251001', null,     4000,  '{}', null),
  ('professional', 'chat_edit',            'claude-haiku-4-5-20251001', null,     4000,  '{}', null),
  ('expert',       'chat_edit',            'claude-sonnet-5',           'low',    8000,  '{claude-haiku-4-5-20251001}', null),
  ('efficient',    'thread_summary',       'claude-haiku-4-5-20251001', null,     2000,  '{}', null),
  ('professional', 'thread_summary',       'claude-haiku-4-5-20251001', null,     2000,  '{}', null),
  ('expert',       'thread_summary',       'claude-haiku-4-5-20251001', null,     2000,  '{}', null)
on conflict (tier, stage, version) do nothing;

-- Eval results per prompt version, tier and model (SPEC §14 activation gate).
create table public.ai_eval_runs (
  id               uuid primary key default gen_random_uuid(),
  stage            text not null,
  prompt_name      text not null,
  prompt_version   integer not null,
  tier             text not null,
  model_id         text not null,
  mode             text not null check (mode in ('replay', 'live')),
  items            integer not null check (items > 0),
  correct          integer not null check (correct >= 0 and correct <= items),
  accuracy         numeric(6,4) not null,
  cost_micro_usd   bigint not null default 0 check (cost_micro_usd >= 0),
  p50_latency_ms   integer,
  report           jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index ai_eval_runs_lookup_idx on public.ai_eval_runs (stage, prompt_version, tier, created_at desc);

-- Margin events (SPEC §12, §26): AI cost absorbed by the platform.
create table public.margin_events (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('estimation_miss', 'platform_absorbed', 'downgrade')),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  job_id          uuid references public.jobs(id) on delete cascade,
  stage           text,
  cost_micro_usd  bigint not null default 0 check (cost_micro_usd >= 0),
  cost_paise      bigint not null default 0 check (cost_paise >= 0),
  detail          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index margin_events_time_idx on public.margin_events (kind, created_at desc);

alter table public.ai_eval_runs  enable row level security;
alter table public.margin_events enable row level security;
alter table public.ai_eval_runs  force row level security;
alter table public.margin_events force row level security;
revoke all on public.ai_eval_runs, public.margin_events from anon, authenticated;
grant all on public.ai_eval_runs, public.margin_events to service_role;

insert into public.app_config (key, value) values
  -- TODO(review): R-14 — operating FX rate. Illustrative seed; admin-set before launch.
  ('ai.fx', '{"inr_per_usd": "95.00", "buffer_percent": "3"}'::jsonb),
  -- Estimator heuristics (SPEC §12), calibrated from ai_calls.
  ('ai.estimator', '{"chars_per_token": "3.2", "tokenizer_inflation": "1.30", "output_tokens_ratio": "0.35", "p90_multiplier": "1.6", "calibration_window_days": 90}'::jsonb),
  ('ai.concurrency', '{"global": 8, "per_account_jobs": 1, "per_account_chat": 2}'::jsonb),
  -- Minimum eval accuracy for a prompt version to be activated on a route.
  ('ai.eval_thresholds', '{"sheet_classification": "0.95", "column_mapping": "0.90", "ledger_mapping": "0.85"}'::jsonb),
  ('ai.cache_ttl', '"5m"'::jsonb),
  -- Admin warning when a model's prices were last verified longer ago than this.
  ('ai.registry_stale_days', '30'::jsonb)
on conflict (key, version) do nothing;
