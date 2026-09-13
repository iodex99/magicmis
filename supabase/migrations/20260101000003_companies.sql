-- GENERATED from packages/db/migrations/0003_companies.sql. Do not edit.
-- 0003: companies, their keys, blueprints, mapping rules and snapshots (SPEC §9, §10).
--
-- Blueprints are the "memory" -- the template, recipe, mappings and dashboard spec that
-- make next month's refresh cheap. Snapshots hold the aggregates that enable
-- comparatives and continuity checks without keeping raw files.
--
-- SPEC §9 requires account_id on every customer table. blueprints/snapshots/company_keys
-- are listed there with only company_id, but the general rule governs: carrying
-- account_id directly makes the RLS predicate a column comparison rather than a join
-- through companies, which is both faster and impossible to get subtly wrong.

create table public.companies (
  id                      uuid primary key default gen_random_uuid(),
  account_id              uuid not null references public.accounts(id) on delete cascade,
  name                    text not null,

  -- SPEC §2.14: April-March by default, configurable per company. Never hardcode 4.
  fy_start_month          smallint not null default 4
                            check (fy_start_month between 1 and 12),
  number_format           text not null default 'lakhs_crores'
                            check (number_format in ('lakhs_crores', 'absolute', 'millions')),
  decimals                smallint not null default 2 check (decimals between 0 and 6),

  -- SPEC §25: commentary only discusses items above materiality.
  materiality_pct         numeric(6,4) not null default 0.0500
                            check (materiality_pct >= 0 and materiality_pct <= 1),
  materiality_abs_paise   bigint not null default 0 check (materiality_abs_paise >= 0),

  reminder_day_of_month   smallint not null default 7
                            check (reminder_day_of_month between 1 and 28),

  -- SPEC §28.
  lifecycle_state         text not null default 'active'
                            check (lifecycle_state in ('active', 'grace', 'archived', 'purged')),
  memory_fee_anchor_date  date,
  memory_fee_paid_through date,
  grace_started_at        timestamptz,
  archived_at             timestamptz,

  -- SPEC §17: per-company redaction key, so party tokens stay stable month to month.
  -- Stored wrapped by the company DEK; released only to the owner's browser.
  wrapped_redaction_key   bytea,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz
);

create index companies_account_idx on public.companies (account_id) where deleted_at is null;
create index companies_lifecycle_idx on public.companies (lifecycle_state, memory_fee_anchor_date)
  where deleted_at is null;

create trigger companies_touch before update on public.companies
  for each row execute function app.touch_updated_at();

-- SPEC §10: purge is crypto-shredding -- destroy the DEK and the data is unreadable.
create table public.company_keys (
  company_id      uuid primary key references public.companies(id) on delete cascade,
  account_id      uuid not null references public.accounts(id) on delete cascade,
  wrapped_dek     bytea,
  kms_key_version text not null,
  created_at      timestamptz not null default now(),
  rotated_at      timestamptz,
  destroyed_at    timestamptz,

  -- Once destroyed the wrapped DEK must be gone, not merely flagged.
  constraint company_keys_shred_is_real
    check ((destroyed_at is null) = (wrapped_dek is not null))
);

-- SPEC §9: blueprints are versioned and immutable; a change creates a new version.
create table public.blueprints (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  account_id          uuid not null references public.accounts(id) on delete cascade,
  version             integer not null check (version >= 1),

  template_spec       bytea not null,
  recipe              bytea not null,
  mapping_rules       bytea not null,
  dashboard_spec      bytea,

  materiality         jsonb not null default '{}'::jsonb,
  source_fingerprints jsonb not null default '{}'::jsonb,

  created_by_job_id   uuid,
  prev_hash           text not null,
  hash                text not null,
  created_at          timestamptz not null default now(),

  unique (company_id, version)
);

create index blueprints_company_version_idx
  on public.blueprints (company_id, version desc);

-- Immutability is enforced by the database, not by convention.
create trigger blueprints_append_only
  before update or delete on public.blueprints
  for each row execute function app.forbid_mutation();

-- SPEC §18: "apply to all my companies" rules, scoped to the account.
create table public.account_mapping_rules (
  id                     uuid primary key default gen_random_uuid(),
  account_id             uuid not null references public.accounts(id) on delete cascade,
  normalized_pattern     bytea not null,
  mis_head_id            uuid not null,
  created_from_company_id uuid references public.companies(id) on delete set null,
  created_at             timestamptz not null default now(),
  deleted_at             timestamptz
);

create index account_mapping_rules_account_idx
  on public.account_mapping_rules (account_id) where deleted_at is null;

-- SPEC §9: a later snapshot for the same period creates a new version, never overwrites.
create table public.snapshots (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  account_id         uuid not null references public.accounts(id) on delete cascade,
  period             text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  version            integer not null check (version >= 1),

  ledger_balances    bytea not null,
  metric_store       bytea not null,
  -- Aggregates only; no raw values (SPEC §9).
  validation_results jsonb not null default '{}'::jsonb,

  source_fingerprint text,
  engine_version     text not null,
  created_by_job_id  uuid,
  created_at         timestamptz not null default now(),

  unique (company_id, period, version)
);

create index snapshots_company_period_idx
  on public.snapshots (company_id, period, version desc);

create trigger snapshots_append_only
  before update or delete on public.snapshots
  for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.companies             enable row level security;
alter table public.company_keys          enable row level security;
alter table public.blueprints            enable row level security;
alter table public.account_mapping_rules enable row level security;
alter table public.snapshots             enable row level security;

alter table public.companies             force row level security;
alter table public.company_keys          force row level security;
alter table public.blueprints            force row level security;
alter table public.account_mapping_rules force row level security;
alter table public.snapshots             force row level security;

create policy companies_own on public.companies
  for all using (app.owns(account_id)) with check (app.owns(account_id));

create policy blueprints_own on public.blueprints
  for select using (app.owns(account_id));

create policy account_mapping_rules_own on public.account_mapping_rules
  for all using (app.owns(account_id)) with check (app.owns(account_id));

create policy snapshots_own on public.snapshots
  for select using (app.owns(account_id));

-- No policy on company_keys: like account_keys, wrapped DEKs are service-role only.
