-- 0010: app config, model registry, tier routing (SPEC §9, §14).
--
-- SPEC §0.5: no business number is hardcoded in application code. Everything tunable
-- lives here, versioned with effective_from, and every change is audit-logged.

create table public.app_config (
  id                  uuid primary key default gen_random_uuid(),
  key                 text not null,
  value               jsonb not null,
  version             integer not null default 1,
  effective_from      timestamptz not null default now(),
  created_by_admin_id uuid,
  created_at          timestamptz not null default now(),

  unique (key, version)
);

create index app_config_effective_idx on public.app_config (key, effective_from desc);

-- SPEC §14: seeded from official documentation, with the source URL and the date it was
-- verified. The admin console warns when verified_at goes stale.
create table public.model_registry (
  id                              uuid primary key default gen_random_uuid(),
  model_id                        text not null,
  display_name_internal           text not null,
  input_price_per_mtok_micro_usd  bigint not null check (input_price_per_mtok_micro_usd >= 0),
  output_price_per_mtok_micro_usd bigint not null check (output_price_per_mtok_micro_usd >= 0),
  cache_read_multiplier           numeric(6,4) not null default 0.1000
                                    check (cache_read_multiplier >= 0),
  cache_write_multiplier          numeric(6,4) not null default 1.2500
                                    check (cache_write_multiplier >= 0),
  batch_discount                  numeric(6,4) not null default 0.5000
                                    check (batch_discount >= 0 and batch_discount <= 1),
  available                       boolean not null default true,
  version                         integer not null default 1,
  -- SPEC §0.4: never guess an API shape or a price. A row without a source is a guess.
  source_url                      text not null,
  verified_at                     timestamptz not null,
  created_at                      timestamptz not null default now(),

  unique (model_id, version)
);

create table public.tier_routing (
  id             uuid primary key default gen_random_uuid(),
  tier           text not null
                   check (tier in ('efficient', 'professional', 'expert', 'expert_plus')),
  stage          text not null,
  model_id       text not null,
  effort         text,
  -- SPEC §14: max_tokens is set per stage from config; never unbounded.
  max_tokens     integer not null check (max_tokens > 0),
  fallback_chain text[] not null default '{}',
  version        integer not null default 1,
  created_at     timestamptz not null default now(),

  unique (tier, stage, version)
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.app_config     enable row level security;
alter table public.model_registry enable row level security;
alter table public.tier_routing   enable row level security;

alter table public.app_config     force row level security;
alter table public.model_registry force row level security;
alter table public.tier_routing   force row level security;

-- No customer policies anywhere in this migration.
--
-- SPEC §2.5: users never see model names or AI cost, so model_registry and tier_routing
-- must never be client-readable. app_config holds internal limits and our cost model,
-- so the few values a customer legitimately needs (GST rate, pack thresholds) are
-- served through an endpoint that picks them out, not by exposing the table.
