-- R-53: break-glass grants are scoped to one company, can require a second admin's approval, and
-- start their clock only when approved (ADR 0025).

alter table public.break_glass_grants
  add column company_id  uuid references public.companies(id) on delete cascade,
  add column minutes     integer check (minutes is null or minutes > 0),
  add column approved_by uuid references public.admin_users(id),
  add column approved_at timestamptz,
  add column account_wide boolean not null default false;

-- Grants from before this migration were account-wide and active at creation.
update public.break_glass_grants
   set approved_at = created_at, account_wide = true,
       minutes = greatest(1, ceil(extract(epoch from (expires_at - created_at)) / 60)::int)
 where approved_at is null;
alter table public.break_glass_grants alter column minutes set not null;

-- New grants name a company; only pre-existing grants may lack one.
alter table public.break_glass_grants
  add constraint break_glass_company_required
    check (company_id is not null or account_wide),
  -- A second admin approves; nobody approves their own grant.
  add constraint break_glass_not_self_approved
    check (approved_by is null or approved_by <> admin_user_id);

-- A pending grant has no running clock yet: expires_at is set when it is approved.
alter table public.break_glass_grants alter column expires_at drop not null;
alter table public.break_glass_grants drop constraint break_glass_expiry_after_start;
alter table public.break_glass_grants
  add constraint break_glass_expiry_after_start
    check (expires_at is null or expires_at > created_at),
  add constraint break_glass_active_has_expiry
    check (approved_at is null or expires_at is not null);

create index break_glass_grants_company_idx on public.break_glass_grants (company_id, expires_at desc);

-- TODO(review): R-53 — turn on once there are at least two active admins.
insert into public.app_config (key, value) values
  ('admin.break_glass_second_admin', 'false'::jsonb)
on conflict (key, version) do nothing;
