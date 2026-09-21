-- GENERATED from packages/db/migrations/0054_purchase_buyer_snapshot.sql. Do not edit.
-- The buyer, as they were when they bought (ADR 0057).
--
-- An invoice records what was sold, to whom, on the day. `purchases` already snapshots the
-- currency, the rate and the place of supply; the buyer's country and GSTIN were still read live
-- from `accounts` when the invoice was issued, several days later for a bank transfer. A customer
-- correcting their address in between made the two disagree, and
-- `invoices_place_of_supply_is_india_only` then refused the insert **inside the transaction that
-- grants the credits** — so the money was taken, the credit grant rolled back, and every webhook
-- retry failed the same way with nothing to show an operator.
--
-- The snapshot closes it at the source: the invoice is built from the sale, not from the account.

alter table public.purchases add column buyer_country text;
alter table public.purchases add column buyer_gstin text;

-- Existing rows: a rupee sale was an Indian one by construction, and the check constraint below
-- makes that true for good. A foreign-currency sale takes the account's country unless the account
-- has since become Indian, which is the very disagreement this column exists to prevent.
update public.purchases p
   set buyer_country = case
         when p.currency = 'INR' then 'IN'
         else coalesce(nullif((select a.billing_country from public.accounts a where a.id = p.account_id), 'IN'), 'US')
       end,
       buyer_gstin = case
         when p.currency = 'INR' then (select a.gstin from public.accounts a where a.id = p.account_id)
         else null
       end;

alter table public.purchases alter column buyer_country set not null;

-- Currency follows country (ADR 0030): India is billed in INR, everywhere else in USD. Holding the
-- two together in the schema is what makes the invoice's own constraint unreachable.
alter table public.purchases add constraint purchases_country_matches_currency
  check ((currency = 'INR') = (buyer_country = 'IN'));

-- An export has no Indian GSTIN on it; `accountTax` already drops it, and now the row cannot hold
-- one either, so a zero-rated export invoice can never print one.
alter table public.purchases add constraint purchases_export_has_no_gstin
  check (buyer_country = 'IN' or buyer_gstin is null);

comment on column public.purchases.buyer_country is
  'The buyer''s country at the moment of sale. The invoice reads this, never the account row.';
comment on column public.purchases.buyer_gstin is
  'The buyer''s GSTIN at the moment of sale, for an Indian sale only.';
