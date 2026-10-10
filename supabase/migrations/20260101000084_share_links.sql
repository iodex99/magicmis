-- GENERATED from packages/db/migrations/0084_share_links.sql. Do not edit.
-- 0084: a company's board shared by a link (ADR 0090).
--
-- The product owner's decision of 2026-10-10 ("we can have a share link") amends locked decision 2
-- (no shared access of any kind) and SPEC §3 (no share links) to allow exactly this: a read-only
-- copy of one company's board, frozen when the link is made, that anyone holding the link can open
-- without an account until it expires or its owner withdraws it. Nothing else is shared, and the
-- link opens no chat, no file and no workbook.
--
-- - The board is a snapshot sealed under the company's own key, so deleting the company destroys
--   every copy it shared, as it destroys everything else (crypto-shredding).
-- - Only a hash of the link's secret is stored: the link itself is shown once, to the person who
--   made it, and a database read cannot reconstruct it.
-- - Every opening is written down before the board is opened, and the owner sees the count and
--   the last time. Nothing about who opened it is kept: there is no account to name.
create table public.share_links (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  company_id    uuid not null,
  token_hash    bytea not null unique check (octet_length(token_hash) = 32),
  -- The month the shared board opens on.
  period        text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  -- Whether the month's commentary and where to act go with it.
  with_writing  boolean not null,
  sealed_board  bytea not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  foreign key (company_id, account_id)
    references public.companies (id, account_id) on delete cascade,
  check (expires_at > created_at)
);

create index share_links_company_idx on public.share_links (company_id, created_at desc);

alter table public.share_links enable row level security;
alter table public.share_links force row level security;

create policy share_links_own on public.share_links
  for select using (app.owns(account_id));

-- Append-only: an opening is a fact, never edited.
create table public.share_link_views (
  id          uuid primary key default gen_random_uuid(),
  share_id    uuid not null references public.share_links(id) on delete cascade,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  viewed_at   timestamptz not null default now()
);

create index share_link_views_share_idx on public.share_link_views (share_id, viewed_at desc);

alter table public.share_link_views enable row level security;
alter table public.share_link_views force row level security;

create policy share_link_views_own on public.share_link_views
  for select using (app.owns(account_id));

-- How long a link lasts unless its owner withdraws it sooner: the default offered, and the
-- longest allowed. Admin-editable (SPEC §0.5).
insert into public.app_config (key, value) values
  ('share.default_days', '30'::jsonb),
  ('share.max_days', '90'::jsonb)
on conflict (key, version) do nothing;
