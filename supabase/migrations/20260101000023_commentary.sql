-- GENERATED from packages/db/migrations/0023_commentary.sql. Do not edit.
-- Phase 7 (SPEC §25): digits allowed in commentary text outside placeholders, as exact phrases.
-- TODO(review): R-37 — confirm the allowlist with the CA reviewer.

insert into public.app_config (key, value) values
  ('commentary.digit_allowlist', '["Schedule III", "Ind AS 115", "Ind AS 116", "AS 9", "Form 26AS", "GSTR-1", "GSTR-3B"]'::jsonb)
on conflict (key, version) do nothing;
