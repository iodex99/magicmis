-- 0038: a company's books keep their own conventions (ADR 0030).
--
-- Migration 0003 already made the financial year, the number format and the decimals
-- per-company, because SPEC §2.14 said the FY was configurable. Two things it did not:
-- the **currency** the books are in, and the **date order** their exports are written in.
--
-- Both were implicitly Indian. Currency was assumed to be rupees everywhere -- the
-- materiality column even says so in its name -- and dates were parsed day-first with no
-- setting at all. Neither is safe for a company in Ohio, and the date one is the worse of
-- the two: `03/04` read the wrong way round moves a month of vouchers, and every total
-- still balances afterwards.
--
-- These are the reporting company's own conventions and have nothing to do with how its
-- owner is billed. A CA firm in Mumbai invoiced in rupees may report a client whose books
-- are in dirhams; the account's `billing_country` only supplies the defaults.

alter table public.companies
  add column currency text not null default 'INR'
    check (currency ~ '^[A-Z]{3}$'),
  -- India writes day-first, the United States month-first. Stored, never guessed per
  -- value: a heuristic that flips on seeing a number above 12 reads 05/04 wrong in
  -- silence. Ingestion checks a whole column against this and stops on a contradiction.
  add column date_order text not null default 'day_first'
    check (date_order in ('day_first', 'month_first'));

comment on column public.companies.currency is
  'ISO 4217 of the company''s own books, not of its billing (ADR 0030).';
comment on column public.companies.date_order is
  'How this company''s exports write ambiguous numeric dates. Verified against each file.';

-- The materiality threshold is in the company's currency, so its name should not say
-- paise. Same integer minor units as before; existing rows are rupees and stay correct
-- because the default currency is INR.
alter table public.companies
  rename column materiality_abs_paise to materiality_abs_minor;

comment on column public.companies.materiality_abs_minor is
  'Integer minor units of companies.currency.';
