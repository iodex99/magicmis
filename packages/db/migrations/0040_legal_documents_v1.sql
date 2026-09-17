-- 0040: full drafts of the terms, privacy notice and processing notice (R-10, R-11, R-12).
--
-- The documents moved from outlines to complete drafts, so their versions move too. The
-- processing notice is enforced per version (apps/web/src/lib/server/consent.ts): an
-- existing account is shown the new notice before its next upload, which is the right
-- behaviour for a material change to how its files are described.
--
-- Contacts the documents name, held in config rather than written into the pages so that
-- filling them in is an admin edit, not a deploy. Every value is a placeholder until the
-- owner supplies it.
--
-- TODO(review): R-10, R-11, R-12 — legal sign-off before launch; the versions become "1.0"
-- when it is given.

insert into public.app_config (key, value, version)
select 'legal.document_versions',
       jsonb_build_object('terms', '1.0-draft', 'privacy', '1.0-draft', 'processing', '1.0-draft'),
       coalesce(max(version), 0) + 1
  from public.app_config where key = 'legal.document_versions';

insert into public.app_config (key, value) values
  ('legal.contacts', jsonb_build_object(
    'support_email', 'PENDING-REVIEW',
    'privacy_email', 'PENDING-REVIEW',
    'grievance_officer_name', 'PENDING-REVIEW',
    'grievance_officer_email', 'PENDING-REVIEW',
    'jurisdiction_city', 'PENDING-REVIEW',
    'last_updated', '2026-09-17'
  ))
on conflict (key, version) do nothing;
