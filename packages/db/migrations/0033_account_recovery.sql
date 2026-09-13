-- R-21: manual account recovery (docs/runbooks/account-recovery.md) as an admin console action.
-- A verified request is recorded, the customer is told and has a hold period to cancel, and only then
-- may an admin (a second one when `admin.recovery_second_admin` is on) remove the second factor.

create table public.account_recoveries (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  requested_by    uuid not null references public.admin_users(id),
  ticket_ref      text not null check (char_length(ticket_ref) between 1 and 100),
  reason          text not null check (char_length(reason) between 20 and 500),
  requested_at    timestamptz not null default now(),
  hold_until      timestamptz not null,
  cancelled_at    timestamptz,
  cancelled_by    uuid references public.admin_users(id),
  completed_at    timestamptz,
  completed_by    uuid references public.admin_users(id),
  factors_removed integer check (factors_removed is null or factors_removed >= 0),
  constraint account_recovery_hold_after_request check (hold_until > requested_at),
  constraint account_recovery_one_outcome check (cancelled_at is null or completed_at is null)
);
create index account_recoveries_account_idx on public.account_recoveries (account_id, requested_at desc);
-- At most one open request per account.
create unique index account_recoveries_open_idx on public.account_recoveries (account_id)
  where cancelled_at is null and completed_at is null;

alter table public.account_recoveries enable row level security;
alter table public.account_recoveries force row level security;
revoke all on public.account_recoveries from anon, authenticated;

insert into public.app_config (key, value) values
  -- SPEC §8 recovery hold: the customer has this long to cancel a request they did not make.
  ('admin.recovery_hold_hours', '24'::jsonb),
  -- TODO(review): R-21 — turn on once there are at least two active admins.
  ('admin.recovery_second_admin', 'false'::jsonb)
on conflict (key, version) do nothing;
