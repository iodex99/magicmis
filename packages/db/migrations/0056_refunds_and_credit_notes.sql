-- A refund is a fact beside the sale, and the document that records it (ADR 0058).
--
-- Before this, any `refund.*` event set `status = 'refunded'` whatever the amount. Three things
-- followed from that: `accountingCsv('credits_sold')` filters on `status = 'credited'`, so a
-- purchase refunded in July vanished from the May it was sold in while its tax invoice stayed in
-- May's GST summary; the business page lost cash that had genuinely been received; and a ₹100
-- refund on a ₹50,000 purchase read as a full one.
--
-- So the refund is recorded in its own columns and the sale keeps its status. Credits are still
-- never reversed (ADR 0054) — this changes what is written down, not what is done.

alter table public.purchases add column refunded_minor bigint not null default 0
  check (refunded_minor >= 0);
alter table public.purchases add column refunded_at timestamptz;

-- A refund cannot exceed what was charged.
alter table public.purchases add constraint purchases_refund_within_total
  check (refunded_minor <= total_minor);
-- The two move together: an amount means a date, and a date means an amount.
alter table public.purchases add constraint purchases_refund_dated
  check ((refunded_minor = 0) = (refunded_at is null));

comment on column public.purchases.refunded_minor is
  'Integer minor units refunded so far, in the purchase currency. Partial refunds accumulate.';

-- A credit note is a document in its own right (Rule 53 CGST Rules), with its own series and its
-- own place in the same gapless per-financial-year counter. It records the reduction in the
-- taxable value and the tax on it, and it names the invoice it corrects.
--
-- TODO(review): R-10/R-12 — the wording, and when one may be issued (§34 CGST Act sets a time
-- limit), go to the CA with the rest of the legal review.
alter table public.invoices drop constraint if exists invoices_type_check;
alter table public.invoices add constraint invoices_type_check
  check (type in ('tax_invoice', 'proforma', 'credit_note'));

alter table public.invoices add column corrects_invoice_id uuid
  references public.invoices(id) on delete restrict;

-- Only a credit note corrects something, and a credit note must say what.
alter table public.invoices add constraint invoices_credit_note_corrects
  check ((type = 'credit_note') = (corrects_invoice_id is not null));

create index invoices_corrects_idx on public.invoices (corrects_invoice_id)
  where corrects_invoice_id is not null;

comment on column public.invoices.corrects_invoice_id is
  'The tax invoice this credit note reduces (Rule 53). Null on every other document type.';

-- The series for it, beside the two that already exist.
insert into public.app_config (key, value, version)
select 'billing.invoice_series',
       (select value from public.app_config where key = 'billing.invoice_series'
         order by version desc limit 1) || jsonb_build_object('credit_note', 'CRN'),
       coalesce(max(version), 0) + 1
  from public.app_config where key = 'billing.invoice_series';

-- One tax invoice and one proforma per purchase still, but a purchase may be refunded more than
-- once and each refund is its own credit note. The unique constraint covered every type, so the
-- second partial refund could not be documented at all.
alter table public.invoices drop constraint invoices_purchase_id_type_key;
create unique index invoices_one_per_purchase_type_idx
  on public.invoices (purchase_id, type) where type <> 'credit_note';

-- Which refunds have been counted. Razorpay sends `refund.created`, `refund.processed` and
-- `refund.speed_changed` for the *same* refund, each as its own event, so counting by event
-- would count one refund several times. The refund's own id is what identifies it.
alter table public.purchases add column refund_ids text[] not null default '{}';
