-- GENERATED from packages/db/migrations/0074_company_logo.sql. Do not edit.
-- 0074: a company's own logo, shown on its dashboard and when it is presented.
--
-- Sealed under the company's data key like every other file it owns, so deleting the company
-- (crypto-shredding, SPEC §10) leaves the logo as unreadable as the rest. The type is the one the
-- server found in the bytes, never the one the browser declared. The version is a fresh id per
-- upload: it is the cache key in the logo's URL, so a replaced logo is never served stale, and it
-- carries nothing about the image itself.
alter table public.companies
  add column logo_sealed  bytea,
  add column logo_type    text check (logo_type in ('image/png', 'image/jpeg', 'image/webp')),
  add column logo_version uuid,
  add constraint companies_logo_whole check (
    (logo_sealed is null) = (logo_type is null) and (logo_type is null) = (logo_version is null)
  );

-- Limits are configuration (SPEC §0.5): a logo is a mark for a header, not a photograph.
insert into public.app_config (key, value) values
  ('companies.logo_max_bytes', '1048576'::jsonb),
  -- Pixels on the longer side. A 1 MB file can still declare a 30,000 px canvas that a browser
  -- must allocate to draw; nothing a header shows needs more than this.
  ('companies.logo_max_side_px', '4096'::jsonb)
on conflict (key, version) do nothing;
