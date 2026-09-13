-- 0014: wallet, billing and admin identity (SPEC §11, §12, §13, §26; Phase 2).

-- ---------------------------------------------------------------------------
-- credit_ledger ordering
-- ---------------------------------------------------------------------------
-- The per-account hash chain needs a definite order. created_at is transaction-start
-- time and ties within and across fast transactions; the Phase 0 audit-log defect (a
-- random uuid breaking the tie) must not recur here. Writes are serialised per account by
-- the wallet row lock, so seq order is commit order within an account.
alter table public.credit_ledger add column seq bigserial not null;
alter table public.credit_ledger add constraint credit_ledger_seq_unique unique (seq);
create index credit_ledger_account_seq_idx on public.credit_ledger (account_id, seq);
drop index public.credit_ledger_account_time_idx;

-- ---------------------------------------------------------------------------
-- Reservations: what kind of hold, and how much was captured
-- ---------------------------------------------------------------------------
alter table public.reservations
  add column kind text not null default 'realtime'
    check (kind in ('realtime', 'review', 'batch', 'chat')),
  add column captured_amount bigint not null default 0 check (captured_amount >= 0),
  add column idempotency_key text,
  add constraint reservations_captured_within_amount check (captured_amount <= amount);
create unique index reservations_idempotency_idx
  on public.reservations (account_id, idempotency_key) where idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- Price book: an action may take its price from another (cancel_after_ai_fee)
-- ---------------------------------------------------------------------------
alter table public.price_book add column price_from_action_key text;
alter table public.price_book add column enabled boolean not null default true;

-- ---------------------------------------------------------------------------
-- Webhook de-duplication (SPEC §4, §13)
-- ---------------------------------------------------------------------------
create table public.webhook_events (
  provider      text not null check (provider in ('razorpay', 'resend')),
  event_id      text not null,
  event_type    text not null,
  payload_hash  text not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  outcome       text,
  primary key (provider, event_id)
);
alter table public.webhook_events enable row level security;
alter table public.webhook_events force row level security;
revoke all on public.webhook_events from anon, authenticated;
grant all on public.webhook_events to service_role;

-- ---------------------------------------------------------------------------
-- Purchases: snapshot what was bought, so a later pack edit never changes history
-- ---------------------------------------------------------------------------
alter table public.purchases
  add column credits bigint not null default 0 check (credits >= 0),
  add column bonus_credits bigint not null default 0 check (bonus_credits >= 0),
  add column gst_rate text,
  add column place_of_supply_state_code text,
  add column idempotency_key text,
  add column bank_transfer_requested_at timestamptz,
  add column received_by_admin_id uuid;
create unique index purchases_idempotency_idx
  on public.purchases (account_id, idempotency_key) where idempotency_key is not null;
create unique index purchases_razorpay_payment_idx
  on public.purchases (razorpay_payment_id) where razorpay_payment_id is not null;

-- ---------------------------------------------------------------------------
-- Invoices: snapshot seller and buyer as issued (SPEC §13, CGST Rule 46)
-- ---------------------------------------------------------------------------
alter table public.invoices
  add column seller jsonb not null default '{}'::jsonb,
  add column buyer jsonb not null default '{}'::jsonb,
  add column place_of_supply_state_name text,
  add column series text not null default 'INV';
-- CGST Rule 46(b): serial ≤ 16 characters of letters, digits, '-' and '/'.
alter table public.invoices add constraint invoices_number_rule46
  check (number ~ '^[A-Za-z0-9/-]{1,16}$');

-- ---------------------------------------------------------------------------
-- Admin identity (SPEC §26): separate from customer accounts, never an auth.users row
-- ---------------------------------------------------------------------------
create table public.admin_users (
  id               uuid primary key default gen_random_uuid(),
  email            text not null,
  password_hash    text not null,
  -- AES-256-GCM envelope ciphertext (packages/crypto); the plaintext TOTP secret never
  -- rests in the database.
  totp_secret_enc  bytea not null,
  status           text not null default 'active' check (status in ('active', 'disabled')),
  created_at       timestamptz not null default now(),
  last_login_at    timestamptz
);
create unique index admin_users_email_idx on public.admin_users (lower(email));

create table public.admin_sessions (
  id            uuid primary key default gen_random_uuid(),
  admin_id      uuid not null references public.admin_users(id) on delete cascade,
  -- SHA-256 of the cookie token. The token itself is never stored.
  token_hash    text not null unique,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  ip            inet,
  user_agent    text
);
create index admin_sessions_admin_idx on public.admin_sessions (admin_id, created_at desc);

alter table public.admin_users    enable row level security;
alter table public.admin_sessions enable row level security;
alter table public.admin_users    force row level security;
alter table public.admin_sessions force row level security;
revoke all on public.admin_users, public.admin_sessions from anon, authenticated;
grant all on public.admin_users, public.admin_sessions to service_role;

-- ---------------------------------------------------------------------------
-- Seed price book and packs (SPEC §12). TODO(review): R-04/R-05 — illustrative values,
-- admin-editable; new versions supersede these.
-- ---------------------------------------------------------------------------
insert into public.price_book
  (action_key, base_credits, tier_multipliers, instant_surcharge_credits, max_ai_cost_ratio,
   reservation_mode, price_from_action_key)
values
  ('data_diagnostic',          299, '{"efficient":"0.8","professional":"1.0","expert":"2.5"}', 0,  0.2000, 'fixed',  null),
  ('company_setup',            999, '{"efficient":"0.8","professional":"1.0","expert":"2.5"}', 0,  0.2000, 'fixed',  null),
  ('reference_mis_recreate',   499, '{"efficient":"0.8","professional":"1.0","expert":"2.5"}', 0,  0.2000, 'fixed',  null),
  ('monthly_refresh',          299, '{"efficient":"0.8","professional":"1.0","expert":"2.5"}', 0,  0.2000, 'fixed',  null),
  ('refresh_with_restructure', 599, '{"efficient":"0.8","professional":"1.0","expert":"2.5"}', 0,  0.2000, 'fixed',  null),
  ('dashboard_addon',          299, '{"efficient":"0.8","professional":"1.0","expert":"2.5"}', 0,  0.2000, 'fixed',  null),
  ('dashboard_refresh',         99, '{"efficient":"0.8","professional":"1.0","expert":"2.5"}', 0,  0.2000, 'fixed',  null),
  ('commentary',               149, '{"efficient":"0.8","professional":"1.0","expert":"2.5"}', 49, 0.2000, 'fixed',  null),
  ('chat_quick',                19, '{"efficient":"0.8","professional":"1.0","expert":"2.5"}', 0,  0.2000, 'fixed',  null),
  ('chat_deep',                 99, '{"efficient":"0.8","professional":"1.0","expert":"2.5"}', 0,  0.2000, 'capped', null),
  ('chat_edit',                 19, '{"efficient":"0.8","professional":"1.0","expert":"2.5"}', 0,  0.2000, 'fixed',  null),
  -- Not tiered: a flat monthly fee and a flat restore fee.
  ('company_memory_monthly',    99, '{"efficient":"1.0","professional":"1.0","expert":"1.0"}', 0,  0.2000, 'fixed',  null),
  ('company_restore',          299, '{"efficient":"1.0","professional":"1.0","expert":"1.0"}', 0,  0.2000, 'fixed',  null),
  -- SPEC §12: "= data_diagnostic". The base here is ignored; price comes from that action.
  ('cancel_after_ai_fee',        0, '{"efficient":"1.0","professional":"1.0","expert":"1.0"}', 0,  0.2000, 'fixed',  'data_diagnostic')
on conflict (action_key, version) do nothing;

insert into public.credit_packs (price_paise_ex_gst, credits_granted, bonus_credits, sort_order) values
  (  200000,   2000,     0, 1),
  (  500000,   5000,   250, 2),
  ( 1000000,  10000,   750, 3),
  ( 2500000,  25000,  2500, 4),
  ( 5000000,  50000,  6000, 5),
  (10000000, 100000, 15000, 6);

-- ---------------------------------------------------------------------------
-- Config (SPEC §0.5). All admin-editable.
-- ---------------------------------------------------------------------------
insert into public.app_config (key, value) values
  ('wallet.lot_validity_months', '12'::jsonb),
  ('wallet.reservation_ttl_seconds', '{"realtime":7200,"review":259200,"batch":93600,"chat":1800}'::jsonb),
  ('wallet.heartbeat_stale_seconds', '600'::jsonb),
  ('wallet.lot_expiry_notice_days', '[30, 7]'::jsonb),
  ('wallet.low_balance_threshold_credits', '500'::jsonb),
  ('pricing.rounding_mode', '"half_up"'::jsonb),
  ('pricing.quote_endings', '[49, 99]'::jsonb),
  ('pricing.quote_validity_hours', '24'::jsonb),
  -- TODO(review): R-13 — confirm the GST rate for the service's SAC before launch.
  ('billing.gst_rate_percent', '"18"'::jsonb),
  -- TODO(review): R-03 — SAC code pending CA confirmation; the placeholder is refused at
  -- invoice issue in production (see packages/billing).
  ('billing.sac_code', '"PENDING-REVIEW"'::jsonb),
  -- TODO(review): R-02 — seller legal details.
  ('billing.seller', '{"legal_name":"PENDING-REVIEW","gstin":"","state_code":"27","address":["PENDING-REVIEW"]}'::jsonb),
  -- CGST Rule 46(b): ≤ 16 characters. SPEC §13's example INV/2026-27/000123 is 18.
  ('billing.invoice_number_format', '"{series}/{fy_short}/{seq:6}"'::jsonb),
  ('billing.bank_transfer_min_paise', '2500000'::jsonb),
  ('billing.bank_transfer_details', '{"account_name":"PENDING-REVIEW","account_number":"","ifsc":"","bank":""}'::jsonb),
  ('billing.proforma_validity_days', '15'::jsonb),
  ('admin.session_idle_seconds', '1800'::jsonb),
  ('admin.session_absolute_seconds', '28800'::jsonb)
on conflict (key, version) do nothing;
