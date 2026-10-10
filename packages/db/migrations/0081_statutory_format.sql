-- 0081: the statutory layout a company's workbook adds beside its MIS (ADR 0087).
--
-- A reporting convention like the others: set when the company is created, from the currency its
-- books are in, and changed only by the owner through the conventions call — never by a run.
-- Companies that already exist start from the same default their currency would have given them,
-- so the first workbook after this migration carries the layout a new company would have had.
-- 'none' leaves the statutory sheets out of the workbook.
alter table public.companies
  add column statutory_format text not null default 'ifrs'
    check (statutory_format in ('schedule_iii', 'uk_companies_act', 'us_gaap', 'ifrs', 'none'));

update public.companies
   set statutory_format = case currency
                            when 'INR' then 'schedule_iii'
                            when 'GBP' then 'uk_companies_act'
                            when 'USD' then 'us_gaap'
                            else 'ifrs'
                          end;
