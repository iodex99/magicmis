-- 0068: the terms, the privacy notice and the processing notice are final (ADR 0074).
--
-- The owner has decided the wording is not reworked for launch, so the drafts become version
-- 1.3 and the page stops saying it awaits review (`LegalDocument` shows that note only while a
-- version ends in "-draft"). All three move together because their wording moved too: data is
-- stored in the United Kingdom rather than India, every provider's region is now stated, and
-- sign-in may be with Google or Apple. The processing notice is enforced per version
-- (apps/web/src/lib/server/consent.ts), so an existing account is shown it again before its
-- next upload — the right behaviour for a change to where its files are held.
--
-- The contact details stay owner facts in `legal.contacts`; only the date the documents were
-- last updated moves with them.

insert into public.app_config (key, value, version)
select 'legal.document_versions',
       jsonb_build_object('terms', '1.3', 'privacy', '1.3', 'processing', '1.3'),
       coalesce(max(version), 0) + 1
  from public.app_config where key = 'legal.document_versions';

insert into public.app_config (key, value, version)
select key, value || jsonb_build_object('last_updated', '2026-09-30'), version + 1
  from public.app_config
 where key = 'legal.contacts'
 order by version desc
 limit 1;
