-- GENERATED from packages/db/migrations/0027_library_votes.sql. Do not edit.
-- SPEC §18 global library promotion (R-31). Account rules are encrypted under each account's key, so
-- counting "the same name in N distinct accounts" needs a separate, minimal record per account rule:
--   name_digest    HMAC-SHA-256 of the normalised name under the platform library key
--   account_digest HMAC-SHA-256 of the account id under the same key — distinct, never which
--   sealed_name    the normalised name under the platform library key, opened only once N is reached
-- Only names that pass the eligibility heuristics (no parties, people or tokens) are ever recorded.

create table public.platform_keys (
  purpose         text primary key check (purpose in ('library')),
  wrapped_dek     bytea not null,
  kms_key_version text not null,
  created_at      timestamptz not null default now()
);
alter table public.platform_keys enable row level security;
alter table public.platform_keys force row level security;
revoke all on public.platform_keys from anon, authenticated;

create table public.library_votes (
  name_digest    bytea not null,
  mis_head_id    uuid not null references public.mis_heads(id) on delete cascade,
  account_digest bytea not null,
  sealed_name    bytea not null,
  created_at     timestamptz not null default now(),
  primary key (name_digest, mis_head_id, account_digest)
);
create index library_votes_account_idx on public.library_votes (account_digest);
alter table public.library_votes enable row level security;
alter table public.library_votes force row level security;
revoke all on public.library_votes from anon, authenticated;
