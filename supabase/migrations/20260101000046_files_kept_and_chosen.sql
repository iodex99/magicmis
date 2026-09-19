-- GENERATED from packages/db/migrations/0046_files_kept_and_chosen.sql. Do not edit.
-- 0046: uploaded files are kept, chosen for the dashboard, and every read of one is recorded
-- (ADR 0047).
--
-- The owner reversed the retention half of ADR 0032: a customer's files are no longer deleted a
-- fixed number of days after upload. They are the customer's record of what the MIS was built
-- from, and stay until the customer deletes them (one file, or the company, which destroys the
-- key they are sealed under). Nothing else about how they are held changes: each chunk is still
-- sealed under the company's data key before it touches the store.
--
-- Three additions:
--   * `periods`       which months a file fed, recorded by the run that read it. It is what
--                     lets a customer untick a file and have its months leave the dashboard.
--   * `on_dashboard`  the tick. A view filter: it reads no new data and is not a priced action.
--   * `source_upload_reads`  one row every time a file is decrypted, with why. The customer
--                     sees it beside the file. "Only you and the runs you start open your
--                     files" is a claim; this is the record that lets them check it.

alter table public.source_uploads
  alter column expires_at drop not null,
  add column periods text[] not null default '{}',
  add column on_dashboard boolean not null default true;

comment on column public.source_uploads.expires_at is
  'Null: kept until the customer deletes it (sources.retention_days = 0).';

-- Zero means "no expiry". Kept as the same key so an operator who must set a period can.
-- TODO(review): R-63 — retention period for uploaded source files; now "until deleted".
insert into public.app_config (key, value, version)
select 'sources.retention_days', '0'::jsonb, coalesce(max(version), 0) + 1
  from public.app_config where key = 'sources.retention_days';

-- Files already held are kept too: their owners were told thirty days, and keeping is the
-- weaker promise only if they cannot delete — they can, from the company's page.
update public.source_uploads set expires_at = null where deleted_at is null;

create table public.source_upload_reads (
  id          bigint generated always as identity primary key,
  upload_id   uuid not null references public.source_uploads(id) on delete cascade,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  -- Why the file was decrypted. There is no value for "a member of staff": no such path exists.
  purpose     text not null
              check (purpose in ('intake', 'pricing', 'run', 'chat', 'download')),
  job_id      uuid,
  read_at     timestamptz not null default now()
);

create index source_upload_reads_upload_idx
  on public.source_upload_reads (upload_id, read_at desc);

create trigger source_upload_reads_append_only
  before update or delete on public.source_upload_reads
  for each row execute function app.forbid_mutation();

alter table public.source_upload_reads enable row level security;
alter table public.source_upload_reads force row level security;

create policy source_upload_reads_own on public.source_upload_reads
  for select using (app.owns(account_id));

-- The privacy and processing notices said files are deleted after a fixed period. They are now
-- kept until deleted, and the terms' security clause promised scheduled deletion, so all three
-- versions move and every account accepts the new processing notice
-- before its next upload.
-- TODO(review): R-11, R-12 — legal sign-off on the new wording before launch.
insert into public.app_config (key, value, version)
select 'legal.document_versions',
       jsonb_build_object('terms', '1.2-draft', 'privacy', '1.2-draft', 'processing', '1.2-draft'),
       coalesce(max(version), 0) + 1
  from public.app_config where key = 'legal.document_versions';
