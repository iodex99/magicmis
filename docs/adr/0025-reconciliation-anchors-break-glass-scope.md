# ADR 0025: Payment reconciliation, integrity anchors, scoped break-glass, account recovery

**Status:** accepted · **Date:** 2026-09-14 · **Phase:** 9 follow-ups (R-21, R-51, R-52, R-53)

## Context

Phase 9 closed with four recorded follow-ups:

- **R-51:** a payment captured by Razorpay whose webhook never arrived within Razorpay's 24-hour retry window needed an engineer to credit it.
- **R-52:** the nightly integrity check detected edited or unlinked rows but not a whole-chain rewrite, trimmed newest rows, or changed timestamps by someone with database owner access.
- **R-53:** break-glass grants covered a whole account, needed no re-authentication, and notified the customer only once.
- **R-21:** manual account recovery (lost authenticator and backup codes) was a witnessed SQL insert, pending an admin console action.

The product owner asked for everything to be built.

## Verified facts (2026-09-14)

| Fact | Source |
|---|---|
| Razorpay "Fetch payments for an order": `GET https://api.razorpay.com/v1/orders/{order_id}/payments`, basic auth `key_id:key_secret`; response `{ entity: "collection", count, items: [...] }`; each item has `id`, `amount` (paise), `currency`, `status` (`created`, `authorized`, `captured`, `refunded`, `failed`), `order_id`, `captured`; the list holds authorised or failed payments. | https://razorpay.com/docs/api/orders/fetch-payments/ |
| Postgres `session_replication_role = replica` skips ordinary triggers; a table owner or superuser can set it. It is how the tests simulate an owner-level attacker bypassing the append-only triggers. | PostgreSQL docs, `session_replication_role` |
| RFC 6238 §5.2: a verifier must not accept the same TOTP code twice. | https://www.rfc-editor.org/rfc/rfc6238 |
| Supabase Auth admin MFA: `auth.admin.mfa.listFactors({ userId })` returns `{ factors: Factor[] }` with `id`, `factor_type`, `status`; `auth.admin.mfa.deleteFactor({ id, userId })`. | `@supabase/auth-js` 2.116.0 `lib/types.d.ts` (`GoTrueAdminMFAApi`) |

## Decisions

### 1. Reconciliation credits from Razorpay's record, through the webhook path (R-51)

- **Gateway:** `PaymentGateway.fetchOrderPayments(orderId)` is added to the gateway interface. The Razorpay client validates the order id shape and the response schema.
- **Task:** `reconcileRazorpayPurchases` runs from the worker task `billing-reconcile` every 15 minutes. It selects Razorpay purchases still `created`, `pending` or `paid` that are older than `billing.reconcile.after_minutes` and younger than `max_age_days`, in batches.
- **Crediting:** a captured INR payment whose amount equals the purchase total is credited with `creditPurchaseInTx`, the function the webhook uses, under the purchase row lock. That one call does the credits, the bonus lot, the tax invoice, the audit and the notice. It also writes `billing.purchase_reconciled`.
- **Mismatches:** a captured payment with a different amount or currency is audited as `billing.payment_amount_mismatch` and never credited.
- **Errors:** a fetch error for one order is counted and retried on the next run.
- **Idempotency:** the purchase row lock and the `credited` status make reconciliation and a late webhook safe in either order. The test covers reconciliation followed by the webhook.
- **Trust:** nothing reported by the browser is used; only Razorpay's API response.

### 2. Keyed anchors over the audit log and credit ledger (R-52)

The row-level chains (ADR 0004) stay as they are. On top of them, `integrity_anchors` (migration 0031) records, per chain:

- **Digest:** `digest = SHA-256(prev_digest ‖ "seq|created_at_micros|hash\n"…)` over every row since the previous anchor.
- **MAC:** `mac = HMAC-SHA-256(anchor key, chain|through_seq|rows|prev_digest|digest)`.
- **Anchor key:** a platform DEK (`platform_keys.audit_anchor`) wrapped by the KMS master key and moved by the re-wrap job.

The nightly `integrity-verify` task anchors newly settled history, then recomputes every anchor. It alerts on:
- `digest_mismatch`: any row edited, inserted, deleted or re-timestamped inside an anchored range;
- `chain_truncated`: the newest rows removed;
- `bad_mac` or `broken_link`: an anchor forged, edited or removed;
- `stale` or `missing`: anchoring stopped.

Design choices:
- **Settle window:** only rows older than `integrity.anchor_settle_seconds` are anchored. A credit-ledger transaction still open when an anchor is written therefore cannot later appear inside the anchored range.
- **Append-only:** anchors have no UPDATE or DELETE grant for the application role, like the chains they cover.
- **Off-database copy:** the daily admin email carries the latest anchors.
- **Admin view:** `/audit?verify=1` shows anchor verification next to chain verification.
- **Effect:** a rewrite now needs the KMS master key as well as the database.
- **Residual risk:** an attacker holding both the database and the KMS role could forge anchors. The emailed copies bound that. Write-once external storage is left as an option (R-52).

### 3. Break-glass: one company, step-up, optional second admin, daily notice (R-53)

- **Scope:** grants name a company (`break_glass_grants.company_id`). Views require an approved, unexpired grant for exactly that company, held by the viewing admin. Grants from before the migration are marked `account_wide`.
- **Step-up:** requesting and approving each need a current TOTP code for the acting admin (`verifyAdminStepUp`). Codes are single-use through `totp_last_step`, as at sign-in.
- **Two-admin approval:** controlled by `admin.break_glass_second_admin`, default off so a solo operator is not locked out. When on, a request waits unapproved with no clock and no customer email. A different admin approves (enforced by code and a database check), and the clock starts and the customer is emailed at approval.
- **Customer notice:** `security.break_glass` when access starts, plus `security.break_glass_viewed` at most once per grant per IST day while it is used. Both reach accounts closed but not yet purged.

### 4. Account recovery is an audited, time-locked console action (R-21)

- **Request:** an admin records a verified request with a ticket reference, a description of what was verified (never the answers) and a current TOTP code. This writes `auth.recovery_requested` and emails the registered address with the hold end (`admin.recovery_hold_hours`). One open request per account is enforced by a partial unique index.
- **Cancel:** any admin cancels on the customer's reply (`auth.recovery_cancelled`).
- **Complete:** only after the hold, with a fresh TOTP code, and with a different admin when `admin.recovery_second_admin` is on. It removes the user's TOTP factors through the Supabase Auth admin API, revokes unused backup codes, clears the active session, writes `auth.mfa_reset_by_admin` (ticket, both admins, factors removed) and emails the customer.
- **No bypass:** nothing disables 2FA; the customer enrols a new authenticator at next sign-in.
- **Test seam:** the Supabase call sits behind an `AuthFactorAdmin` interface, so tests use a fake. The admin deployment needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY`; without them completion refuses with a clear message.

## Consequences

- **Tests:**
  - `packages/billing/test/billing.test.ts`: reconciliation credits once, skips unpaid and mismatched orders, and a late webhook is a no-op.
  - `packages/jobs/test/anchors.test.ts`: anchors hold on untouched history; owner-level timestamp rewrite, forged anchor, wrong master key, trimmed tail and stopped anchoring are each caught.
  - `apps/admin/test/console.test.ts`: company scope, step-up, replayed code, same-day view notice deduplication, two-admin approval, self-approval refused.
  - `apps/admin/test/recovery.test.ts`: validation, step-up, one open request, hold enforced, factor removal with codes revoked and session ended, audit without answers, cancel, two-admin rule.
  - The worker template test and the admin E2E are updated.
- **Runbooks updated:** payment webhook outage, breach response, break-glass, key rotation, account recovery.
- **Operations:**
  - The worker needs `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` for reconciliation.
  - Set `admin.break_glass_second_admin` and `admin.recovery_second_admin` to true once two admins exist (R-53, R-21).
  - The admin deployment needs Supabase admin access for recovery.
