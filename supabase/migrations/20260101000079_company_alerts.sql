-- GENERATED from packages/db/migrations/0079_company_alerts.sql. Do not edit.
-- 0079: alerts a company's owner sets on its own figures (ADR 0087).
--
-- "Tell me when cash falls below this", "when debtor days go above that". They are checked when a
-- run completes, against the figures the engine has just computed — no AI, nothing charged — and
-- the notice it sends names how many fired, never a figure (SPEC §29). The board shows which,
-- because the board shows the figures anyway.
--
-- The threshold is in the metric's own unit as the engine stores it: minor units for money (an
-- integer), a decimal for a ratio or a number of days.
--
-- The company is referenced together with its account, so the database itself refuses an alert
-- filed under one account against another account's company — the route checks ownership first,
-- and this holds for any caller that one day does not.
alter table public.companies
  add constraint companies_id_account_key unique (id, account_id);

create table public.company_alerts (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  company_id  uuid not null,
  metric_id   text not null check (metric_id ~ '^[a-z_]{1,60}$'),
  comparator  text not null check (comparator in ('below', 'above')),
  threshold   text not null check (threshold ~ '^-?[0-9]{1,20}(\.[0-9]{1,6})?$'),
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  foreign key (company_id, account_id)
    references public.companies (id, account_id) on delete cascade
);

create index company_alerts_company_idx on public.company_alerts (company_id)
  where deleted_at is null;

alter table public.company_alerts enable row level security;
alter table public.company_alerts force row level security;

create policy company_alerts_own on public.company_alerts
  for select using (app.owns(account_id));
