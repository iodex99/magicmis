-- GENERATED from packages/db/migrations/0008_chat_outputs.sql. Do not edit.
-- 0008: chat threads, messages, query steps, generated outputs (SPEC §9, §27).

create table public.chat_threads (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  company_id      uuid not null references public.companies(id) on delete cascade,
  period_range    jsonb not null default '{}'::jsonb,
  message_count   integer not null default 0 check (message_count >= 0),
  seeded_summary  bytea,
  status          text not null default 'open' check (status in ('open', 'capped')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index chat_threads_company_idx on public.chat_threads (company_id, created_at desc);

create trigger chat_threads_touch before update on public.chat_threads
  for each row execute function app.touch_updated_at();

create table public.chat_messages (
  id                       uuid primary key default gen_random_uuid(),
  thread_id                uuid not null references public.chat_threads(id) on delete cascade,
  account_id               uuid not null references public.accounts(id) on delete cascade,
  role                     text not null check (role in ('user', 'assistant', 'system')),
  message_type             text check (message_type in ('quick', 'deep', 'edit', 'investigate')),

  content                  bytea not null,
  -- SPEC §25: the answer is stored as a template of placeholders, with the resolved
  -- values kept separately. Storing only the rendered text would lose the guarantee
  -- that every number came from the engine.
  rendered_answer_template bytea,
  resolved_values          bytea,

  credits_charged          bigint not null default 0 check (credits_charged >= 0),
  reservation_id           uuid references public.reservations(id) on delete set null,
  rounds_used              integer not null default 0 check (rounds_used >= 0),
  state                    text not null default 'pending' check (state in
                             ('pending', 'running', 'needs_query', 'completed',
                              'failed_data', 'failed_platform', 'declined_out_of_scope')),
  created_at               timestamptz not null default now(),

  -- SPEC §27: a user message must declare its type, because the type is the price.
  constraint chat_messages_user_declares_type
    check (role <> 'user' or message_type is not null)
);

create index chat_messages_thread_idx on public.chat_messages (thread_id, created_at);

create table public.chat_query_steps (
  id              uuid primary key default gen_random_uuid(),
  chat_message_id uuid not null references public.chat_messages(id) on delete cascade,
  account_id      uuid not null references public.accounts(id) on delete cascade,
  round           integer not null check (round >= 1),
  sql_text        bytea not null,
  guard_result    jsonb not null default '{}'::jsonb,
  row_count       integer check (row_count is null or row_count >= 0),
  result_digest   text,
  created_at      timestamptz not null default now(),

  unique (chat_message_id, round)
);

-- SPEC §10: Excel outputs are stored encrypted with a retention expiry (default 90 days).
create table public.outputs (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  account_id   uuid not null references public.accounts(id) on delete cascade,
  job_id       uuid references public.jobs(id) on delete set null,
  type         text not null check (type in ('excel', 'dashboard_spec')),
  storage_path text not null,
  byte_size    bigint not null check (byte_size >= 0),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz
);

create index outputs_company_idx on public.outputs (company_id, created_at desc);
create index outputs_expiry_idx on public.outputs (expires_at) where expires_at is not null;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.chat_threads     enable row level security;
alter table public.chat_messages    enable row level security;
alter table public.chat_query_steps enable row level security;
alter table public.outputs          enable row level security;

alter table public.chat_threads     force row level security;
alter table public.chat_messages    force row level security;
alter table public.chat_query_steps force row level security;
alter table public.outputs          force row level security;

create policy chat_threads_own on public.chat_threads
  for select using (app.owns(account_id));

create policy chat_messages_own on public.chat_messages
  for select using (app.owns(account_id));

create policy outputs_own on public.outputs
  for select using (app.owns(account_id));

-- chat_query_steps holds generated SQL and guard verdicts: operator diagnostics, not
-- customer-facing. Service role only.
