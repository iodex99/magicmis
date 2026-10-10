-- 0077: the preparer's own name and mark on what is presented and delivered (ADR 0087).
--
-- Whoever prepares a company's MIS — an accountant, a bookkeeper, the company's own finance
-- team — may put their name and logo beside the company's in Present and on the workbook's cover.
-- It is off until they turn it on: an owner presenting their own business does not want to be
-- told who prepared it.
--
-- The logo is sealed under the account's data key, so erasing the account (which shreds that
-- key) leaves it unreadable, and the purge clears the columns too. As with a company's logo, the
-- type is the one found in the bytes and the version is a fresh id per upload, used as the cache
-- key in its URL.
alter table public.accounts
  add column brand_on           boolean not null default false,
  add column brand_logo_sealed  bytea,
  add column brand_logo_type    text check (brand_logo_type in ('image/png', 'image/jpeg', 'image/webp')),
  add column brand_logo_version uuid,
  add constraint accounts_brand_logo_whole check (
    (brand_logo_sealed is null) = (brand_logo_type is null)
    and (brand_logo_type is null) = (brand_logo_version is null)
  );
