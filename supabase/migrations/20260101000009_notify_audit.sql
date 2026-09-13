-- GENERATED from packages/db/migrations/0009_notify_audit.sql. Do not edit.
-- 0009: notifications and the hash-chained audit log (SPEC §4, §9, §30).

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  type       text not null,
  payload    jsonb not null default '{}'::jsonb,
  channel    text not null default 'email' check (channel in ('email')),
  status     text not null default 'queued'
               check (status in ('queued', 'sent', 'failed', 'suppressed')),
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  -- Idempotency for recurring notices: one "memory fee due" per company-month, not one
  -- per worker tick.
  dedupe_key text,

  unique (account_id, dedupe_key)
);

create index notifications_pending_idx on public.notifications (status, created_at)
  where status = 'queued';

comment on column public.notifications.payload is
  'SPEC §29: templates carry no financial figures from customer data. Payload holds ids and labels only.';

-- SPEC §4: append-only, hash-chained. Covers auth events, wallet mutations, pricing and
-- config changes, admin actions, deletions and consent records.
create table public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  -- The chain's order, and the only safe one.
  --
  -- created_at defaults to now(), which is transaction-start time: every row written in
  -- one transaction shares it, and two fast transactions can share it too. Ordering by
  -- (created_at, id) then falls back to a RANDOM uuid to break ties, so the "latest"
  -- row is not deterministic -- which silently corrupts both the tail lookup on append
  -- and any paged walk. Appends are serialised by an advisory lock, so seq order is
  -- commit order.
  seq         bigserial not null unique,
  actor_type  text not null check (actor_type in ('account', 'admin', 'system')),
  actor_id    uuid,
  action      text not null,
  target_type text,
  target_id   uuid,
  -- SPEC §9: no financial data content. Ids, labels and outcomes only.
  metadata    jsonb not null default '{}'::jsonb,
  ip          inet,
  prev_hash   text not null,
  hash        text not null,
  created_at  timestamptz not null default now()
);

-- The chain is verified in insertion order; this index is what the nightly job walks.
create index audit_log_chain_idx on public.audit_log (seq);
create index audit_log_actor_idx on public.audit_log (actor_type, actor_id, created_at desc);
create index audit_log_target_idx on public.audit_log (target_type, target_id, created_at desc);

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.notifications enable row level security;
alter table public.audit_log     enable row level security;

alter table public.notifications force row level security;
alter table public.audit_log     force row level security;

create policy notifications_own on public.notifications
  for select using (app.owns(account_id));

-- audit_log gets no customer policy. It records admin actions and system events across
-- all tenants; a per-account view would leak the shape of our operations.
