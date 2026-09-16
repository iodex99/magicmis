-- GENERATED from packages/db/migrations/0037_billing_currency.sql. Do not edit.
-- 0037: bill India in rupees and the rest of the world in dollars (ADR 0030).
--
-- Credits are unchanged and deliberately so. The price book prices an action in credits,
-- the wallet holds credits, the ledger moves credits -- none of that has a currency.
-- Currency exists only where money is taken: the pack price, the purchase, the invoice.
--
-- The billing COUNTRY is the input, not the currency: it decides both what we charge in
-- and whether the sale carries GST or is a zero-rated export of services under §16 of the
-- IGST Act. Storing the currency without the country would lose the reason for the tax
-- treatment, which is the thing an auditor asks about.

-- ---------------------------------------------------------------------------
-- 1. Where the customer is billed
-- ---------------------------------------------------------------------------

-- Nullable for the same reason state_code is (migration 0034): billing details are
-- collected at the first purchase, not at sign-up.
alter table public.accounts add column billing_country text
  check (billing_country ~ '^[A-Z]{2}$');

comment on column public.accounts.billing_country is
  'ISO 3166-1 alpha-2. IN -> billed in INR with GST; anything else -> USD, zero-rated export (ADR 0030).';

-- Every account that already has a state code is Indian by construction: state_code is a
-- GST state code and only an Indian supply has one.
update public.accounts set billing_country = 'IN' where state_code is not null;

-- A GST state code on a non-Indian account would be a contradiction that silently
-- produces a domestic tax invoice for an export.
alter table public.accounts add constraint accounts_state_code_is_india_only
  check (state_code is null or billing_country = 'IN');

-- ---------------------------------------------------------------------------
-- 2. Pack prices, one row per currency
-- ---------------------------------------------------------------------------
--
-- A child table rather than two columns: a pack that is not offered in a currency simply
-- has no row, which is a state two nullable columns cannot express without a rule about
-- what NULL means. Prices are SET per currency, never converted -- a price that moves with
-- the exchange rate is not a price (SPEC §0.5 keeps them in config either way).

create table public.credit_pack_prices (
  pack_id            uuid not null references public.credit_packs(id) on delete cascade,
  currency           text not null check (currency in ('INR', 'USD')),
  -- Integer minor units of `currency`: paise for INR, cents for USD. Both are
  -- two-decimal currencies, which is what lets one column serve both.
  price_minor_ex_tax bigint not null check (price_minor_ex_tax > 0),
  created_at         timestamptz not null default now(),
  primary key (pack_id, currency)
);

comment on table public.credit_pack_prices is
  'What a credit pack costs in each billing currency. Set, never converted (ADR 0030).';

insert into public.credit_pack_prices (pack_id, currency, price_minor_ex_tax)
  select id, 'INR', price_paise_ex_gst from public.credit_packs;

-- Dropped rather than left in place: two sources for one price is how they disagree.
alter table public.credit_packs drop column price_paise_ex_gst;

-- TODO(review): R-05 — illustrative USD prices, admin-editable like the INR ones.
--
-- Set, not converted. They are pitched near the rupee price at a round dollar figure
-- rather than at any particular exchange rate, because a price that moves with the market
-- is not a price and because the cost of serving a customer abroad is not the cost of
-- serving one here. The owner sets the real numbers alongside R-04.
insert into public.credit_pack_prices (pack_id, currency, price_minor_ex_tax)
  select id, 'USD',
    case credits_granted
      when   2000 then    2900   -- $29
      when   5000 then    6900   -- $69
      when  10000 then   12900   -- $129
      when  25000 then   29900   -- $299
      when  50000 then   57900   -- $579
      when 100000 then  109900   -- $1,099
    end
  from public.credit_packs
  where credits_granted in (2000, 5000, 10000, 25000, 50000, 100000);

alter table public.credit_pack_prices enable row level security;
alter table public.credit_pack_prices force row level security;

-- The price book is public (SPEC §2.3 lists viewing it as uncharged), like credit_packs.
create policy credit_pack_prices_read on public.credit_pack_prices
  for select using (true);

grant select on public.credit_pack_prices to authenticated, anon;

-- ---------------------------------------------------------------------------
-- 3. Purchases carry their currency, and their columns stop claiming to be paise
-- ---------------------------------------------------------------------------
--
-- Renamed rather than reinterpreted. A column called `total_paise` holding US cents is a
-- lie that every future reader has to be told about individually, and money is the last
-- place to leave that trap.

alter table public.purchases rename column amount_paise_ex_gst to amount_minor_ex_tax;
alter table public.purchases rename column gst_paise  to tax_minor;
alter table public.purchases rename column cgst_paise to cgst_minor;
alter table public.purchases rename column sgst_paise to sgst_minor;
alter table public.purchases rename column igst_paise to igst_minor;
alter table public.purchases rename column total_paise to total_minor;

alter table public.purchases add column currency text not null default 'INR'
  check (currency in ('INR', 'USD'));

-- An export of services is zero-rated: there is no such thing as a USD purchase of ours
-- carrying Indian GST, and this is the constraint that says so rather than a comment.
alter table public.purchases add constraint purchases_usd_is_zero_rated
  check (currency = 'INR' or (tax_minor = 0 and cgst_minor = 0
         and sgst_minor = 0 and igst_minor = 0));

-- Bank transfer is an Indian bank transfer against a proforma. An international wire is a
-- different operational process (FIRC, purpose code) and is not offered.
alter table public.purchases add constraint purchases_bank_transfer_is_inr
  check (method <> 'bank_transfer' or currency = 'INR');

-- ---------------------------------------------------------------------------
-- 4. Invoices: a tax invoice, or an export invoice
-- ---------------------------------------------------------------------------

alter table public.invoices add column currency text not null default 'INR'
  check (currency in ('INR', 'USD'));

-- Where the buyer is. On an export invoice this is what place of supply means.
--
-- Backfilled by the column default rather than an UPDATE: `invoices` is append-only
-- (migration 0007) and the trigger refuses an UPDATE even from a migration, which is the
-- guard working exactly as intended. Adding a NOT NULL column with a default is DDL, so
-- every existing row gets 'IN' -- correct, since they could only have been domestic. The
-- default is then dropped so a new invoice has to state where its buyer is.
alter table public.invoices add column buyer_country text not null default 'IN'
  check (buyer_country ~ '^[A-Z]{2}$');
alter table public.invoices alter column buyer_country drop default;

-- The endorsement an export invoice must carry, and the LUT it is made under. Held on the
-- row rather than rendered from config at print time: an invoice is a statutory record of
-- what was issued, and config changes.
alter table public.invoices add column export_endorsement text;
alter table public.invoices add column lut_arn text;

-- A GST place of supply is an Indian state code; an export has none. Drop the NOT NULL
-- and keep the shape check for the rows that do have one.
alter table public.invoices alter column place_of_supply_state_code drop not null;
alter table public.invoices add constraint invoices_place_of_supply_is_india_only
  check (place_of_supply_state_code is null or buyer_country = 'IN');

-- An export invoice says so, and a domestic one does not.
alter table public.invoices add constraint invoices_export_endorsed
  check ((currency = 'INR' and export_endorsement is null)
         or (currency = 'USD' and export_endorsement is not null));

-- ---------------------------------------------------------------------------
-- 5. Config for the export side
-- ---------------------------------------------------------------------------
--
-- The LUT ARN is a real value from the GST portal and nobody here can invent one, so it
-- is a placeholder guarded the same way the seller details are (R-27): invoicing refuses
-- to issue against a placeholder once `billing.allow_placeholder_details` is false.

insert into public.app_config (key, value) values
  ('billing.export', jsonb_build_object(
    'lut_arn', 'PENDING-REVIEW',
    'endorsement',
      'Supply meant for export without payment of IGST, zero rated supply as per Section 16, IGST Act, 2017'
  ))
on conflict (key, version) do nothing;
