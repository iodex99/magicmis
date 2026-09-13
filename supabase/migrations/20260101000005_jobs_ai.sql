-- GENERATED from packages/db/migrations/0005_jobs_ai.sql. Do not edit.
-- 0005: jobs, stage outputs, AI call accounting, quotes, estimator calibration
-- (SPEC §9, §12, §14, §23).

create table public.jobs (
  id                         uuid primary key default gen_random_uuid(),
  account_id                 uuid not null references public.accounts(id) on delete cascade,
  company_id                 uuid references public.companies(id) on delete cascade,

  type                       text not null check (type in (
                               'data_diagnostic', 'company_setup', 'reference_mis_recreate',
                               'monthly_refresh', 'refresh_with_restructure',
                               'dashboard_addon', 'dashboard_refresh', 'commentary')),
  tier                       text not null default 'professional'
                               check (tier in ('efficient', 'professional', 'expert', 'expert_plus')),
  delivery_mode              text not null default 'standard'
                               check (delivery_mode in ('standard', 'instant')),

  -- SPEC §23 state machine.
  state                      text not null default 'draft' check (state in (
                               'draft', 'estimated', 'needs_quote', 'quote_accepted', 'reserved',
                               'preflight', 'profiling', 'classifying', 'mapping',
                               'awaiting_review', 'computing', 'validating', 'rendering',
                               'commentary_queued', 'commentary_done',
                               'completed', 'failed_data', 'failed_platform',
                               'cancelled', 'expired')),
  stage_checkpoints          jsonb not null default '{}'::jsonb,

  price_credits              bigint check (price_credits is null or price_credits >= 0),
  quote_id                   uuid,
  reservation_id             uuid,
  captured_credits           bigint check (captured_credits is null or captured_credits >= 0),

  failure_class              text check (failure_class in
                               ('data_fault', 'platform_fault', 'user_cancelled', 'expired')),
  failure_code               text,
  failure_detail             text,

  estimated_ai_cost_micro_usd bigint check (estimated_ai_cost_micro_usd is null
                                            or estimated_ai_cost_micro_usd >= 0),
  actual_ai_cost_micro_usd   bigint not null default 0 check (actual_ai_cost_micro_usd >= 0),
  actual_ai_cost_paise       bigint not null default 0 check (actual_ai_cost_paise >= 0),

  idempotency_key            text not null,
  heartbeat_at               timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  completed_at               timestamptz,

  unique (account_id, idempotency_key),

  -- A terminal failure must say which class it was; billing depends on it (SPEC §23).
  constraint jobs_failure_is_classified
    check (state not in ('failed_data', 'failed_platform') or failure_class is not null)
);

create index jobs_account_created_idx on public.jobs (account_id, created_at desc);
create index jobs_company_idx on public.jobs (company_id, created_at desc);
-- Drives the reservation sweeper (SPEC §11.6).
create index jobs_running_heartbeat_idx on public.jobs (heartbeat_at)
  where state not in ('completed', 'failed_data', 'failed_platform', 'cancelled', 'expired');

create trigger jobs_touch before update on public.jobs
  for each row execute function app.touch_updated_at();

-- SPEC §9: so a retry reuses finished AI stages and never pays twice (SPEC §23).
create table public.job_stage_outputs (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references public.jobs(id) on delete cascade,
  account_id     uuid not null references public.accounts(id) on delete cascade,
  stage          text not null,
  output         bytea not null,
  schema_version integer not null default 1,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz,

  unique (job_id, stage)
);

create index job_stage_outputs_expiry_idx on public.job_stage_outputs (expires_at)
  where expires_at is not null;

-- SPEC §14: one row per Anthropic call. This table is the margin dashboard's source of
-- truth, so it records what was asked for AND what was delivered.
create table public.ai_calls (
  id                        uuid primary key default gen_random_uuid(),
  job_id                    uuid references public.jobs(id) on delete cascade,
  chat_message_id           uuid,
  account_id                uuid not null references public.accounts(id) on delete cascade,

  stage                     text not null,
  prompt_version            text not null,

  model_requested           text not null,
  model_used                text not null,
  fallback_from             text,
  effort                    text,
  max_tokens                integer not null check (max_tokens > 0),

  input_tokens              integer not null default 0 check (input_tokens >= 0),
  output_tokens             integer not null default 0 check (output_tokens >= 0),
  cache_creation_input_tokens integer not null default 0 check (cache_creation_input_tokens >= 0),
  cache_read_input_tokens   integer not null default 0 check (cache_read_input_tokens >= 0),

  is_batch                  boolean not null default false,
  batch_id                  text,

  -- SPEC §4: micro-USD plus the INR equivalent at the rate in effect. Both, always,
  -- so a later rate change never silently restates history.
  usd_cost_micro            bigint not null default 0 check (usd_cost_micro >= 0),
  inr_cost_paise            bigint not null default 0 check (inr_cost_paise >= 0),
  fx_rate_used              numeric(12,6),

  latency_ms                integer check (latency_ms is null or latency_ms >= 0),
  anthropic_request_id      text,
  status                    text not null default 'ok'
                              check (status in ('ok', 'error', 'timeout', 'invalid_output')),
  error_type                text,
  created_at                timestamptz not null default now(),

  -- A successful call with a cost must record the rate that produced its INR figure.
  constraint ai_calls_inr_cost_has_rate
    check (inr_cost_paise = 0 or fx_rate_used is not null)
);

create index ai_calls_account_time_idx on public.ai_calls (account_id, created_at desc);
create index ai_calls_job_idx on public.ai_calls (job_id);
-- Feeds the margin dashboard and nightly estimator calibration.
create index ai_calls_stage_time_idx on public.ai_calls (stage, created_at desc);

create table public.quotes (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  job_id     uuid references public.jobs(id) on delete cascade,
  reason     text not null check (reason in
               ('estimate_over_cap', 'runtime_cap', 'restructure', 'expert_plus')),
  credits    bigint not null check (credits > 0),
  expires_at timestamptz not null,
  status     text not null default 'offered'
               check (status in ('offered', 'accepted', 'declined', 'expired')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index quotes_account_idx on public.quotes (account_id, created_at desc);
create index quotes_expiry_idx on public.quotes (expires_at) where status = 'offered';

-- SPEC §12: p90 by size bucket, refreshed nightly from actual ai_calls. Global, not
-- tenant data -- it is our cost model, not a customer's.
create table public.estimator_calibration (
  id                    uuid primary key default gen_random_uuid(),
  action_key            text not null,
  tier                  text not null,
  size_bucket           text not null,
  p50_cost_micro_usd    bigint not null default 0 check (p50_cost_micro_usd >= 0),
  p90_cost_micro_usd    bigint not null default 0 check (p90_cost_micro_usd >= 0),
  sample_count          integer not null default 0 check (sample_count >= 0),
  updated_at            timestamptz not null default now(),

  unique (action_key, tier, size_bucket),
  constraint estimator_p90_not_below_p50 check (p90_cost_micro_usd >= p50_cost_micro_usd)
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.jobs               enable row level security;
alter table public.job_stage_outputs  enable row level security;
alter table public.ai_calls           enable row level security;
alter table public.quotes             enable row level security;
alter table public.estimator_calibration enable row level security;

alter table public.jobs               force row level security;
alter table public.job_stage_outputs  force row level security;
alter table public.ai_calls           force row level security;
alter table public.quotes             force row level security;
alter table public.estimator_calibration force row level security;

create policy jobs_own on public.jobs
  for select using (app.owns(account_id));

create policy quotes_own on public.quotes
  for select using (app.owns(account_id));

-- SPEC §2.5: users never see tokens, model names or AI cost. ai_calls and
-- job_stage_outputs therefore get NO customer-facing policy at all -- service role only.
-- estimator_calibration is our cost model; likewise no customer policy.
