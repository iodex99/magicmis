-- GENERATED from packages/db/migrations/0047_company_storage_cap.sql. Do not edit.
-- 0047: a cap on what one company may keep (ADR 0048, closes R-65).
--
-- Files are kept until their owner deletes them (ADR 0047), so without a limit one company
-- could keep storing for ever. Storage is cheap next to the monthly company memory fee that
-- already pays for holding a company's data, so keeping files is not priced separately: it is
-- capped, generously, and the cap is configuration an operator can raise for a customer who
-- needs it. The value is a seed (SPEC §0.5), not a constant in code.
-- TODO(review): R-65 — confirm the default cap against real storage cost once it is known.

insert into public.app_config (key, value) values
  -- Bytes of stored source files per company: 2 GiB, about two hundred 10 MB day books.
  ('sources.max_company_bytes', '2147483648'::jsonb)
on conflict (key, version) do nothing;
