-- GENERATED from packages/db/migrations/0031_integrity_anchors.sql. Do not edit.
-- R-52: tamper-evident anchors over the audit log and the credit ledger (ADR 0025).
--
-- The row-level hash chains detect an edited or unlinked row, but someone with database owner access
-- could rewrite a chain end to end, trim its newest rows, or change timestamps, which are not hashed.
-- Each anchor carries a running SHA-256 digest over every row's (seq, created_at, hash) since the
-- previous anchor, and an HMAC of that digest under a platform key wrapped by the KMS master key.
-- Rewriting history then needs the master key as well as the database.

alter table public.platform_keys drop constraint platform_keys_purpose_check;
alter table public.platform_keys
  add constraint platform_keys_purpose_check check (purpose in ('library', 'audit_anchor'));

create table public.integrity_anchors (
  id           bigserial primary key,
  chain        text not null check (chain in ('audit_log', 'credit_ledger')),
  through_seq  bigint not null check (through_seq >= 0),
  rows_covered bigint not null check (rows_covered >= 0),
  prev_digest  text not null check (prev_digest ~ '^[0-9a-f]{64}$'),
  digest       text not null check (digest ~ '^[0-9a-f]{64}$'),
  mac          text not null check (mac ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now(),
  unique (chain, through_seq)
);
alter table public.integrity_anchors enable row level security;
alter table public.integrity_anchors force row level security;
revoke all on public.integrity_anchors from anon, authenticated;
-- Append-only for the application role, like the chains it covers.
revoke update, delete, truncate on public.integrity_anchors from service_role;

insert into public.app_config (key, value) values
  -- Rows younger than this are left for the next anchor, so a transaction still open when the
  -- anchor is written cannot later appear inside an anchored range.
  ('integrity.anchor_settle_seconds', '600'::jsonb),
  -- The nightly check alerts when the newest anchor is older than this.
  ('integrity.anchor_max_age_hours', '36'::jsonb)
on conflict (key, version) do nothing;
