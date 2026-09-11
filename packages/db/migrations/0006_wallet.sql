-- 0006: price book, packs, lots, wallets, reservations, ledger (SPEC §9, §11, §12).
--
-- Every invariant here is a database constraint, not an application check. The wallet is
-- the one place where a bug is a direct financial loss, and application code can be
-- bypassed by a migration, a console session or a future endpoint that forgets a rule.

-- SPEC §12: versioned with effective_from. Admin-editable; no price is ever hardcoded
-- in application code (SPEC §0.5).
create table public.price_book (
  id                        uuid primary key default gen_random_uuid(),
  action_key                text not null,
  base_credits              bigint not null check (base_credits >= 0),
  tier_multipliers          jsonb not null default '{}'::jsonb,
  instant_surcharge_credits bigint not null default 0 check (instant_surcharge_credits >= 0),
  max_ai_cost_ratio         numeric(5,4) not null default 0.2000
                              check (max_ai_cost_ratio > 0 and max_ai_cost_ratio <= 1),
  reservation_mode          text not null default 'fixed'
                              check (reservation_mode in ('fixed', 'capped')),
  version                   integer not null default 1,
  effective_from            timestamptz not null default now(),
  created_by_admin_id       uuid,
  created_at                timestamptz not null default now(),

  unique (action_key, version)
);

create index price_book_effective_idx
  on public.price_book (action_key, effective_from desc);

create table public.credit_packs (
  id                 uuid primary key default gen_random_uuid(),
  price_paise_ex_gst bigint not null check (price_paise_ex_gst > 0),
  credits_granted    bigint not null check (credits_granted > 0),
  bonus_credits      bigint not null default 0 check (bonus_credits >= 0),
  active             boolean not null default true,
  sort_order         integer not null default 0,
  version            integer not null default 1,
  created_at         timestamptz not null default now()
);

-- SPEC §11: lots expire (config, default 12 months) and are consumed FIFO by earliest
-- expires_at.
create table public.credit_lots (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts(id) on delete cascade,
  source            text not null
                      check (source in ('purchase', 'bonus', 'admin_grant', 'goodwill')),
  credits_granted   bigint not null check (credits_granted > 0),
  credits_remaining bigint not null check (credits_remaining >= 0),
  expires_at        timestamptz not null,
  purchase_id       uuid,
  created_at        timestamptz not null default now(),

  constraint credit_lots_remaining_within_granted
    check (credits_remaining <= credits_granted)
);

-- The FIFO consumption order, as an index.
create index credit_lots_fifo_idx
  on public.credit_lots (account_id, expires_at, created_at)
  where credits_remaining > 0;

-- SPEC §11: denormalised, and the lock row for every wallet transaction.
create table public.wallets (
  account_id      uuid primary key references public.accounts(id) on delete cascade,
  balance_credits bigint not null default 0,
  held_credits    bigint not null default 0,
  updated_at      timestamptz not null default now(),

  -- SPEC §11: no negative balances, and held can never exceed balance. These three are
  -- the invariants the property tests assert; having them here means the tests are
  -- checking the database is right, not standing in for it.
  constraint wallets_balance_non_negative check (balance_credits >= 0),
  constraint wallets_held_non_negative    check (held_credits >= 0),
  constraint wallets_held_within_balance  check (held_credits <= balance_credits)
);

create table public.reservations (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  job_id          uuid references public.jobs(id) on delete cascade,
  chat_message_id uuid,
  amount          bigint not null check (amount > 0),
  status          text not null default 'held' check (status in
                    ('held', 'captured', 'partially_captured', 'released', 'expired')),
  expires_at      timestamptz not null,
  heartbeat_at    timestamptz,
  created_at      timestamptz not null default now(),
  settled_at      timestamptz,

  -- A reservation belongs to exactly one thing.
  constraint reservations_single_subject
    check (num_nonnulls(job_id, chat_message_id) = 1)
);

create index reservations_sweeper_idx
  on public.reservations (expires_at, heartbeat_at) where status = 'held';
create index reservations_account_idx on public.reservations (account_id, created_at desc);

-- SPEC §9: append-only, hash-chained. No UPDATE or DELETE grant at the role level
-- (0011), plus a trigger so the guarantee survives a superuser session too.
create table public.credit_ledger (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  entry_type      text not null check (entry_type in
                    ('grant', 'reserve', 'release', 'capture', 'expire', 'admin_adjust')),
  amount          bigint not null,
  lot_id          uuid references public.credit_lots(id) on delete set null,
  reservation_id  uuid references public.reservations(id) on delete set null,
  job_id          uuid references public.jobs(id) on delete set null,

  -- The running state after this entry. Replaying the ledger must reproduce `wallets`
  -- exactly; that is a property test in packages/wallet.
  balance_after   bigint not null check (balance_after >= 0),
  held_after      bigint not null check (held_after >= 0),

  idempotency_key text not null unique,
  prev_hash       text not null,
  hash            text not null,
  created_at      timestamptz not null default now(),

  constraint credit_ledger_held_within_balance check (held_after <= balance_after)
);

create index credit_ledger_account_time_idx
  on public.credit_ledger (account_id, created_at, id);

create trigger credit_ledger_append_only
  before update or delete on public.credit_ledger
  for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.price_book     enable row level security;
alter table public.credit_packs   enable row level security;
alter table public.credit_lots    enable row level security;
alter table public.wallets        enable row level security;
alter table public.reservations   enable row level security;
alter table public.credit_ledger  enable row level security;

alter table public.credit_lots    force row level security;
alter table public.wallets        force row level security;
alter table public.reservations   force row level security;
alter table public.credit_ledger  force row level security;

-- SPEC §2.3: viewing the price book and packs is one of the few uncharged activities,
-- so both are readable by any authenticated user. Writes are service role only.
create policy price_book_read on public.price_book
  for select using (auth.uid() is not null);

create policy credit_packs_read on public.credit_packs
  for select using (auth.uid() is not null and active);

-- Customers read their own wallet state; every mutation goes through the service role
-- inside a locked transaction.
create policy credit_lots_own on public.credit_lots
  for select using (app.owns(account_id));

create policy wallets_own on public.wallets
  for select using (app.owns(account_id));

create policy reservations_own on public.reservations
  for select using (app.owns(account_id));

create policy credit_ledger_own on public.credit_ledger
  for select using (app.owns(account_id));
