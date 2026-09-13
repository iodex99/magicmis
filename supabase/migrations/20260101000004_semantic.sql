-- GENERATED from packages/db/migrations/0004_semantic.sql. Do not edit.
-- 0004: the canonical MIS schema and the global mapping library (SPEC §9, §18).
--
-- These are GLOBAL, not tenant data. They carry no account_id and no RLS scoping to an
-- account -- every tenant reads the same rows.
--
-- SPEC §18: the global library holds only generic account names, never party names.
-- Tenant-specific names never enter it without admin approval. That rule is the reason
-- these tables are readable by everyone, and it is enforced in the promotion flow plus
-- the check constraint below.

create table public.mis_heads (
  id                uuid primary key default gen_random_uuid(),
  parent_id         uuid references public.mis_heads(id) on delete restrict,
  code              text not null unique,
  name              text not null,
  statement         text not null
                      check (statement in ('pnl', 'balance_sheet', 'working_capital', 'memo')),
  schedule_iii_ref  text,
  normal_balance    text not null check (normal_balance in ('debit', 'credit')),
  sort_order        integer not null default 0,
  version           integer not null default 1,
  created_at        timestamptz not null default now()
);

create index mis_heads_parent_idx on public.mis_heads (parent_id, sort_order);

-- SPEC §18: "Unmapped" is always a visible head. Nothing is ever silently dropped
-- (validation V1 depends on this row existing).
insert into public.mis_heads (code, name, statement, normal_balance, sort_order)
values ('UNMAPPED', 'Unmapped', 'memo', 'debit', 9999);

create table public.global_mapping_library (
  id                  uuid primary key default gen_random_uuid(),
  normalized_name     text not null unique,
  aliases             text[] not null default '{}',
  mis_head_id         uuid not null references public.mis_heads(id) on delete restrict,
  source              text not null check (source in ('seed', 'promoted')),
  promoted_by_admin_id uuid,
  tenant_count        integer not null default 0 check (tenant_count >= 0),
  created_at          timestamptz not null default now(),

  -- A promoted entry must name the admin who approved it (SPEC §18: admin-reviewed
  -- only, never automatic).
  constraint global_library_promotion_is_attributed
    check (source = 'seed' or promoted_by_admin_id is not null)
);

create index global_mapping_library_head_idx on public.global_mapping_library (mis_head_id);

create table public.library_candidates (
  id                     uuid primary key default gen_random_uuid(),
  normalized_name        text not null,
  proposed_mis_head_id   uuid not null references public.mis_heads(id) on delete cascade,
  -- Distinct accounts, never which accounts: the candidate queue must not become a way
  -- to learn who banks with whom.
  distinct_account_count integer not null default 0 check (distinct_account_count >= 0),
  status                 text not null default 'pending'
                           check (status in ('pending', 'approved', 'rejected')),
  reviewed_by            uuid,
  reviewed_at            timestamptz,
  created_at             timestamptz not null default now(),

  unique (normalized_name, proposed_mis_head_id)
);

create index library_candidates_pending_idx
  on public.library_candidates (status, distinct_account_count desc) where status = 'pending';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--
-- Global reference data: readable by any authenticated user, writable only by the
-- service role. RLS is enabled so the default-deny applies to writes.

alter table public.mis_heads              enable row level security;
alter table public.global_mapping_library enable row level security;
alter table public.library_candidates     enable row level security;

create policy mis_heads_read on public.mis_heads
  for select using (auth.uid() is not null);

create policy global_mapping_library_read on public.global_mapping_library
  for select using (auth.uid() is not null);

-- library_candidates gets no policy at all: it is an admin queue, service role only.
