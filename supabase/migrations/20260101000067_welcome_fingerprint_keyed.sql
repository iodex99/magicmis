-- GENERATED from packages/db/migrations/0067_welcome_fingerprint_keyed.sql. Do not edit.
-- 0067: the welcome fingerprint is keyed, disclosed, and erased a year after deletion (ADR 0072).
--
-- A fingerprint of an email address is personal data under the DPDP Act 2023 (section 2(t)): its
-- whole purpose is to recognise the same person when they come back, and an unkeyed SHA-256 can be
-- reversed by hashing candidate addresses. So it is now an HMAC under a platform key the KMS wraps,
-- like the library's digests, and it is kept after an account is deleted for a stated period only.

-- The platform key the fingerprint is made with.
alter table public.platform_keys drop constraint platform_keys_purpose_check;
alter table public.platform_keys
  add constraint platform_keys_purpose_check check (purpose in ('library', 'audit_anchor', 'welcome'));

-- How long a deleted account's fingerprint is kept, in days. One year: the period the DPDP Rules
-- 2025 themselves use for keeping processing logs after an account is deleted (rule 8(3)), and
-- long enough to cover delete-and-rejoin. Admin-editable (the wallet. prefix).
insert into public.app_config (key, value) values
  ('wallet.welcome_fingerprint_retention_days', '365'::jsonb)
on conflict (key, version) do nothing;

-- Fingerprints made before this migration were unkeyed and cannot be compared with keyed ones.
-- None exist outside development databases, where they belong to test accounts.
update public.welcome_credits set mailbox_digest = null where mailbox_digest is not null;
