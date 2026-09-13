-- SPEC §10, §31: DPDP-aligned data export. Generated asynchronously by the worker, sealed under the
-- account data key in private storage, and offered through a time-limited link to the signed-in owner.

create table public.data_exports (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  status       text not null default 'queued' check (status in ('queued', 'ready', 'failed', 'expired')),
  storage_path text,
  byte_size    bigint check (byte_size is null or byte_size >= 0),
  failure      text,
  requested_at timestamptz not null default now(),
  ready_at     timestamptz,
  expires_at   timestamptz,
  updated_at   timestamptz not null default now(),
  constraint data_exports_ready_shape
    check (status <> 'ready' or (storage_path is not null and ready_at is not null and expires_at is not null))
);
create index data_exports_account_idx on public.data_exports (account_id, requested_at desc);
create index data_exports_queue_idx on public.data_exports (status, requested_at) where status in ('queued', 'ready');

create trigger data_exports_touch before update on public.data_exports
  for each row execute function app.touch_updated_at();

alter table public.data_exports enable row level security;
alter table public.data_exports force row level security;
create policy data_exports_own on public.data_exports
  for select using (app.owns(account_id));
revoke insert, update, delete, truncate on public.data_exports from anon, authenticated;

-- 0025 seeded `legal.versions`, duplicating `legal.document_versions` (0012), which signup reads.
-- Nothing reads the duplicate; remove it so there is one source of truth for document versions.
delete from public.app_config where key = 'legal.versions';

-- TODO(review): R-49. How long a ready export stays downloadable.
insert into public.app_config (key, value) values
  ('privacy.export_link_hours', '72'::jsonb)
on conflict (key, version) do nothing;
