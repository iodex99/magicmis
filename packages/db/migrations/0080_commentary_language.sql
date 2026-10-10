-- 0080: the language a company's commentary and "where to act" are written in (ADR 0087).
--
-- A reporting convention like the others: written at creation, changed only by the owner through
-- the conventions call, and never by a run. English unless the owner chooses another of the
-- languages the evals measured (COMMENTARY_LANGUAGES in @magicmis/core). It changes the words
-- around the figures and nothing else: every figure is still the engine's, and the placeholder
-- check refuses any Unicode digit. Japanese and Chinese are left out on purpose: they also write
-- numbers as ideographs the check cannot tell from ordinary words.
alter table public.companies
  add column commentary_language text not null default 'en'
    check (commentary_language in ('en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'ar', 'hi'));
