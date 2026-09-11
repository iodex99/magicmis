-- 0007: purchases, invoices, invoice counters (SPEC §9, §13).

create table public.purchases (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  pack_id            uuid references public.credit_packs(id) on delete set null,

  amount_paise_ex_gst bigint not null check (amount_paise_ex_gst > 0),
  gst_paise          bigint not null default 0 check (gst_paise >= 0),
  cgst_paise         bigint not null default 0 check (cgst_paise >= 0),
  sgst_paise         bigint not null default 0 check (sgst_paise >= 0),
  igst_paise         bigint not null default 0 check (igst_paise >= 0),
  total_paise        bigint not null check (total_paise > 0),

  method             text not null check (method in ('razorpay', 'bank_transfer')),
  razorpay_order_id  text,
  razorpay_payment_id text,
  bank_utr           text,

  status             text not null default 'created' check (status in
                       ('created', 'pending', 'paid', 'credited', 'failed', 'refunded')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  credited_at        timestamptz,

  -- SPEC §13: idempotent by order id. A replayed webhook must not grant twice.
  unique (razorpay_order_id),

  -- SPEC §13: same state -> CGST + SGST; different state -> IGST. Never both.
  constraint purchases_gst_is_intra_or_inter
    check ((cgst_paise + sgst_paise = 0) or (igst_paise = 0)),
  constraint purchases_gst_components_sum
    check (cgst_paise + sgst_paise + igst_paise = gst_paise),
  constraint purchases_total_is_base_plus_gst
    check (total_paise = amount_paise_ex_gst + gst_paise),
  -- CGST and SGST are split equally, to the paisa.
  constraint purchases_cgst_sgst_equal_split
    check (igst_paise > 0 or cgst_paise = sgst_paise or abs(cgst_paise - sgst_paise) = 1)
);

create index purchases_account_idx on public.purchases (account_id, created_at desc);
create index purchases_status_idx on public.purchases (status) where status <> 'credited';

create trigger purchases_touch before update on public.purchases
  for each row execute function app.touch_updated_at();

-- SPEC §13: sequential, gapless numbering per financial year and series.
create table public.invoice_counters (
  financial_year text not null,
  series         text not null default 'INV',
  last_number    bigint not null default 0 check (last_number >= 0),

  primary key (financial_year, series)
);

comment on table public.invoice_counters is
  'Row-locked with SELECT ... FOR UPDATE to issue gapless numbers per FY (SPEC §13).';

create table public.invoices (
  id                        uuid primary key default gen_random_uuid(),
  account_id                uuid not null references public.accounts(id) on delete cascade,
  purchase_id               uuid not null references public.purchases(id) on delete restrict,

  type                      text not null check (type in ('tax_invoice', 'proforma')),
  number                    text not null,
  financial_year            text not null,

  seller_gstin              text not null,
  buyer_gstin               text,
  place_of_supply_state_code text not null check (place_of_supply_state_code ~ '^[0-9]{2}$'),
  sac_code                  text not null,

  line_items                jsonb not null default '[]'::jsonb,
  totals                    jsonb not null default '{}'::jsonb,
  pdf_path                  text,
  issued_at                 timestamptz not null default now(),

  -- Gaplessness is only meaningful if numbers are also unique.
  unique (number),
  -- A purchase gets at most one tax invoice; a proforma may precede it.
  unique (purchase_id, type)
);

create index invoices_account_idx on public.invoices (account_id, issued_at desc);
create index invoices_fy_idx on public.invoices (financial_year, number);

-- An issued tax invoice is a statutory record. It is never edited or deleted --
-- a correction is a credit note, which is a new document.
create trigger invoices_append_only
  before update or delete on public.invoices
  for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.purchases        enable row level security;
alter table public.invoices         enable row level security;
alter table public.invoice_counters enable row level security;

alter table public.purchases        force row level security;
alter table public.invoices         force row level security;
alter table public.invoice_counters force row level security;

create policy purchases_own on public.purchases
  for select using (app.owns(account_id));

create policy invoices_own on public.invoices
  for select using (app.owns(account_id));

-- invoice_counters gets no customer policy: it is shared numbering state, and exposing
-- it would leak total sales volume.
