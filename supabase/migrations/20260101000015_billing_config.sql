-- GENERATED from packages/db/migrations/0015_billing_config.sql. Do not edit.
-- Phase 2 billing additions (SPEC §13).

-- A UTR identifies one bank credit; recording it against two purchases would grant twice.
create unique index purchases_bank_utr_idx
  on public.purchases (bank_utr) where bank_utr is not null;

insert into public.app_config (key, value) values
  -- CGST Rule 46(b) allows multiple series; each is numbered gaplessly per FY.
  ('billing.invoice_series', '{"tax_invoice":"INV","proforma":"PRO"}'::jsonb),
  -- Each tax line is rounded to the paisa on its own.
  ('billing.tax_rounding_mode', '"half_up"'::jsonb),
  -- TODO(review): R-02/R-03 — while true, invoices may be issued with placeholder seller
  -- details and SAC (local and test only). Production must set this to false; issue then
  -- refuses until real details are configured.
  ('billing.allow_placeholder_details', 'true'::jsonb)
on conflict (key, version) do nothing;
