-- GENERATED from packages/db/migrations/0042_legal_documents_server_processing.sql. Do not edit.
-- 0042: the terms, privacy notice and processing notice describe server-side processing
-- (ADR 0032), so their versions move. The processing notice is enforced per version: every
-- account is shown the new notice, which now says files are uploaded, and accepts it before
-- its next upload.
--
-- TODO(review): R-10, R-11, R-12 — legal sign-off before launch; the versions become final when
-- it is given.

insert into public.app_config (key, value, version)
select 'legal.document_versions',
       jsonb_build_object('terms', '1.1-draft', 'privacy', '1.1-draft', 'processing', '1.1-draft'),
       coalesce(max(version), 0) + 1
  from public.app_config where key = 'legal.document_versions';
