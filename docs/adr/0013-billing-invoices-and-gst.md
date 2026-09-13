# ADR 0013 — Billing: webhook-only crediting, Rule 46 invoice numbering, GST per levy, pdf-lib

**Status:** accepted · **Date:** 2026-09-13 · **Phase:** 2

## Context

SPEC §13 requires Razorpay purchases credited only from a verified, de-duplicated webhook;
GST split by place of supply; gapless invoice numbers per financial year and series; a tax
invoice PDF for every credited purchase; bank-transfer proformas; monthly accounting CSVs.

## Decisions

**1. Credits come only from the webhook.** `createRazorpayPurchase` records the purchase and
creates an Order outside any transaction (no locks held across a network call). The checkout
callback verifies `HMAC-SHA256(order_id|payment_id)` so the page can say "payment received",
but grants nothing. `handleRazorpayWebhook` verifies the signature over the **raw body**, inserts
`webhook_events (provider, event_id)` and applies the effect in **one transaction**: a thrown
error leaves no event row, so Razorpay's retry processes it again. Duplicates by event id return
`duplicate`; a second event for an already-credited purchase returns `already_credited` under the
purchase row lock, so out-of-order and concurrent delivery credit exactly once (tested with three
concurrent events). An amount or currency mismatch never credits and is audit-logged.

**2. One crediting transaction.** Lock purchase → grant purchase lot and bonus lot (same expiry,
via `grantCreditsInTx`) → issue tax invoice → mark credited → audit → queue email. Lock order
purchase → wallet → invoice counter → audit log is the same on every path.

**3. Invoice numbers.** `invoice_counters` is incremented with `UPDATE … RETURNING` in the
crediting transaction, so a rollback returns the number (tested: a rolled-back issue leaves no
gap; 20 concurrent credits yield 1..N). CGST Rule 46(b) caps the serial at **16 characters** of
letters, digits, `-` and `/`. **SPEC §13's example `INV/2026-27/000123` is 18 characters**, so the
default format is `{series}/{fy_short}/{seq:6}` → `INV/26-27/000123`; the format stays in config
and every rendered number is validated against Rule 46 at issue time (a non-compliant admin
edit fails the issue rather than truncating). A database CHECK enforces the same pattern. The GST
financial year is April–March in IST regardless of any company's MIS FY. Series come from config
(`INV` tax invoices, `PRO` proformas).

**4. GST per levy.** Intra-state: CGST and SGST each computed at half the rate on the taxable
value and rounded to the paisa independently (so they are always equal); inter-state: IGST at the
full rate. Rounding mode from config (`billing.tax_rounding_mode`, default half-up). Place of
supply: the buyer's GSTIN state code if a checksum-valid GSTIN is on the account, else the billing
state.

**5. Invoice rows are snapshots; PDFs are regenerated.** Seller, buyer, place of supply (code and
name), SAC, line items, totals and amount in words are copied into the immutable invoice row.
The PDF is rendered from that row on demand and not stored (`pdf_path` stays null; the append-only
trigger forbids updating it anyway). Rendering is deterministic: identical bytes for the same row
(tested).

**6. pdf-lib 1.17.1** for PDFs. It ships its own TypeScript types, is pure JavaScript with no
native build, and with `updateMetadata: false` plus pinned creation/modification dates produces
deterministic output. pdfkit 0.20 was considered: its 0.20 restructure ships no types and
`@types/pdfkit` tracks 0.17. pdf-lib's last release is 2022; the risk is accepted because the
feature set used (standard fonts, text, lines) is small and stable. Standard Helvetica covers
WinAnsi only; other characters are replaced (R-25 tracks a Unicode font).

**7. Placeholder guard.** `billing.allow_placeholder_details` (seeded true for local/test) lets
invoices issue with the placeholder seller and SAC. Production must set it false; issue then
refuses while any `PENDING-REVIEW` value or an empty seller GSTIN remains (R-02, R-03).

**8. Bank transfer.** Eligibility from `billing.bank_transfer_min_paise`. A proforma is issued
from its own series. An admin marks receipt with a UTR (12–22 alphanumerics); a partial unique
index prevents one UTR crediting two purchases.

## Verifying documentation

| Fact asserted | URL | Verified on |
|---|---|---|
| Orders API: `POST /v1/orders`, basic auth, amount in paise (min 100), receipt ≤ 40 chars, notes ≤ 15 | https://razorpay.com/docs/api/orders/create/ | 2026-09-13 |
| Checkout options (`key`, `amount`, `currency`, `name`, `order_id`, `handler`, `modal`), handler fields, `payment.failed` event, checkout signature | https://razorpay.com/docs/payments/server-integration/nodejs/integration-steps/ | 2026-09-13 |
| Webhook signature over raw body with webhook secret; `x-razorpay-event-id`; out-of-order delivery | https://razorpay.com/docs/webhooks/validate-test/ | 2026-09-13 |
| `payment.captured`, `order.paid` payloads | https://razorpay.com/docs/webhooks/payments/ | 2026-09-13 |
| CGST Rule 46: 16-character serial, recipient state name and code, place of supply, signature not required for electronic invoices | https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule46_v1.00.html | 2026-09-13 |
| GST state code master | https://einvoice1.gst.gov.in/Others/MasterCodes | 2026-09-13 |
| pdf-lib 1.17.1 API (`PDFDocument.create({ updateMetadata })`, `setCreationDate`, `embedFont(StandardFonts…)`, `drawText`, `save`) | package type declarations, npm `pdf-lib@1.17.1` | 2026-09-13 |

**Not verified:** whether the seller's turnover requires e-invoicing (IRN); that is a CA question
tracked with R-02/R-06.

## Consequences

- A lost webhook means a paid purchase stays `pending`; Razorpay retries, and an operational
  reconciliation job (Phase 9 runbook "payment webhook outage") will poll unpaid orders.
- Changing the invoice number format mid-year is safe only if the new format keeps numbers
  unique within the FY; the DB unique index on `number` enforces it.
