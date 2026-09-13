# Phase 2 — Wallet, pricing, payments, GST

Scope from SPEC §34:

> - Lots, ledger, reservations, sweepers, lot expiry; price book, packs, quotes, price
>   confirmation modal.
> - Razorpay orders, webhooks, invoices with GST split and gapless numbering; bank
>   transfer flow.
> - Accounting exports; minimal admin screens for price book, packs and credit adjustments.
> - *Acceptance:* property and concurrency tests pass; test-mode purchase produces correct
>   credits and invoice PDF; time-travel expiry tests pass.

## Design

**`packages/wallet`** — every operation is one transaction that locks the account's
`wallets` row `FOR UPDATE` (SPEC §11), expires any due lots for that account first (so
`balance = Σ unexpired lots` holds at every operation, not only after the nightly job),
writes `credit_ledger` rows with `balance_after`, `held_after` and a **per-account** hash
chain, and is idempotent on its key.

- `credit_ledger` gains a `bigserial seq`: the Phase 0 audit-log bug (ordering by
  `created_at` with a random-uuid tie-break) would recur here otherwise.
- Capture consumes lots FIFO by earliest `expires_at` and releases the remainder.
- If lot expiry leaves `held > balance`, the newest holds are shrunk by the shortfall and
  a `release` entry records it; the job's capture is then limited (SPEC §11.5).
- Pricing: `round_to_config(base × multiplier + surcharge)` in exact decimal arithmetic;
  multipliers stored as decimal strings; `cancel_after_ai_fee` prices from
  `data_diagnostic` via `price_from_action_key`; quotes round up to configured endings.

**`packages/billing`** — Razorpay behind a `PaymentGateway` interface; credits are granted
**only** from a verified, de-duplicated webhook (SPEC §13); GST split by place of supply;
gapless invoice numbering from a row-locked counter in the same transaction as the invoice
insert, so a rollback cannot leave a gap; invoice PDFs rendered deterministically from the
immutable invoice row; monthly accounting CSVs.

**`packages/crypto`** — AES-256-GCM envelope encryption with a `KeyWrapper` interface: a
local implementation that enforces an encryption context like KMS does (tests, local dev)
and an AWS KMS implementation (ADR 0008). First consumer: admin TOTP secrets.

**`apps/worker`** — pg-boss: reservation sweeper (every 5 minutes), lot expiry (nightly),
lot-expiry notices (30 and 7 days).

**`apps/admin`** — separate Next.js app, separate identity (SPEC §26): allowlisted admin
emails, scrypt passwords, mandatory TOTP, short server-side sessions, every action
audit-logged. Phase 2 screens: price book, packs, account wallet + credit adjustment, bank
transfer queue, accounting exports.

**`apps/web`** — Wallet page (balances, lots with expiry, packs with GST shown before
payment, Razorpay Checkout, bank transfer request, invoices with PDF download, ledger
history), public Pricing page, price confirmation modal and preview endpoint, Razorpay
webhook route.

## External facts verified (2026-09-13)

| Fact | Source |
|---|---|
| `POST /v1/orders`, basic auth key_id:key_secret; `amount` in paise (min 100), `currency`, `receipt` ≤ 40 chars unique, `notes` ≤ 15 pairs; statuses created/attempted/paid; an order maps 1:1 to a payment attempt | https://razorpay.com/docs/api/orders/create/ |
| Checkout success signature = HMAC-SHA256(`order_id|razorpay_payment_id`, key_secret) | https://razorpay.com/docs/payments/server-integration/nodejs/integration-steps/ |
| Webhook signature `X-Razorpay-Signature` = HMAC-SHA256(raw body, webhook secret); never parse before verifying; `x-razorpay-event-id` unique per event for de-duplication; events may arrive out of order | https://razorpay.com/docs/webhooks/validate-test/ |
| `payment.captured` confirms a captured payment; `order.paid` carries order + payment entities | https://razorpay.com/docs/webhooks/payments/ |
| CGST Rule 46: invoice particulars; serial ≤ 16 chars of letters, digits, `-`, `/`, unique per FY; recipient state name and code; place of supply with state name; signature not required for electronic invoices under the IT Act | https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule46_v1.00.html |

**Spec conflict found:** SPEC §13's example number `INV/2026-27/000123` is 18 characters,
exceeding Rule 46's 16. The default format is `INV/26-27/000123` (16). The format stays
config-driven, and the configured pattern is validated against Rule 46 at issue time.

## Tests

- Property (fast-check, real Postgres): random operation sequences never drive balance or
  held negative, and replaying the ledger reproduces `wallets` exactly.
- Concurrency: 50 parallel reservations against a balance that fits 10 → exactly 10.
- Idempotency: every operation, same key twice → one effect.
- Time travel: lot expiry, reservation expiry sweeper, FIFO consumption order.
- Billing: GST intra/inter-state; invoice numbers gapless under concurrent issue and within
  16 characters; amount in words; Razorpay signature verification; duplicate and
  out-of-order webhooks credit exactly once; purchase → credits + invoice + PDF.
- Admin: authentication (password + TOTP + allowlist), session expiry, adjustment audit.
