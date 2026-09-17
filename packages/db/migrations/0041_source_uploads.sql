-- 0041: source files uploaded for server-side processing (ADR 0032).
--
-- The owner reversed SPEC §2.8: files are uploaded, parsed on the server and interpreted with
-- Claude, instead of being processed in the browser. What arrives is kept only as long as a
-- job needs it: each chunk is sealed under the company's data key (so deleting the company
-- crypto-shreds its files with everything else), and every upload carries an expiry after
-- which the purge removes the stored chunks.
--
-- The row holds counts and a name only. Nothing about a file's content is stored here.

create table public.source_uploads (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  company_id   uuid not null references public.companies(id) on delete cascade,
  file_name    text not null check (char_length(file_name) between 1 and 255),
  byte_size    bigint not null check (byte_size > 0),
  chunk_count  integer not null check (chunk_count between 1 and 10000),
  -- Which chunks have arrived: they may arrive in any order and a retry may repeat one.
  stored_chunks integer[] not null default '{}',
  status       text not null default 'uploading'
               check (status in ('uploading', 'ready', 'refused')),
  refusal      text,
  sheet_count  integer check (sheet_count >= 0),
  row_count    bigint check (row_count >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  deleted_at   timestamptz
);

create index source_uploads_company_idx on public.source_uploads (company_id, created_at desc);
create index source_uploads_expiry_idx on public.source_uploads (expires_at)
  where deleted_at is null;

alter table public.source_uploads enable row level security;
alter table public.source_uploads force row level security;

create policy source_uploads_own on public.source_uploads
  for select using (app.owns(account_id));

insert into public.app_config (key, value) values
  -- How long an uploaded file is kept after upload (ADR 0032).
  -- TODO(review): R-63 — retention period for uploaded source files.
  ('sources.retention_days', '30'::jsonb),
  -- Chunk size for uploads: under Vercel's 4.5 MB request body limit.
  ('sources.chunk_bytes', '4000000'::jsonb),
  -- Largest single file accepted.
  ('sources.max_file_bytes', '104857600'::jsonb)
on conflict (key, version) do nothing;
