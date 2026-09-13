# Runbook: suspected breach or integrity alert

**Applies to:** the whole platform (SPEC §30, §31).

**Audience:** the product owner, on-call engineers and whoever handles legal notices.

**Triggers:**
- an `[Integrity alert]` email from the nightly `integrity-verify` task;
- `integrity.check_failed` in `/audit`;
- a leaked credential;
- unexpected admin or break-glass activity;
- a report from a customer or researcher.

> TODO(review): R-50 — confirm the notification duties and timelines with counsel. Two regimes apply:
> - DPDP Act 2023 and its Rules: notice to the Data Protection Board and to affected data principals;
> - CERT-In directions: report within 6 hours of noticing.
>
> Record the confirmed contacts here.

## 1. Contain (first hour)

| Suspected | Do |
|---|---|
| Admin credential or session | Remove the email from `ADMIN_ALLOWED_EMAILS` and redeploy admin. Revoke that admin's `admin_sessions` and revoke active `break_glass_grants`. See [admin-access.md](admin-access.md). |
| Customer account takeover | Suspend the account in the admin console. This ends its session and blocks jobs. |
| Supabase secret key / database URL | Rotate the secret in Supabase. Redeploy web, admin and worker. Rotate the database password. |
| Anthropic API key | Revoke it in the Anthropic console, issue a new one, and redeploy web and worker. Check `ai_calls` for unexpected volume. |
| Razorpay key or webhook secret | Regenerate in the Razorpay dashboard and redeploy. Reconcile payments for the exposure window (see [payment-webhook-outage.md](payment-webhook-outage.md)). |
| KMS key or IAM role | Follow [key-rotation.md](key-rotation.md), "Replacement". |
| Resend key | Revoke it, issue a new one, and redeploy worker. |

Do not delete anything. Rows, logs and the audit chain are the evidence.

## 2. Assess

1. **Verify the audit chain.** Run `/audit?verify=1` in the admin console. Note the first failing row id.
2. **Check the ledgers.** The alert email lists accounts whose ledger does not replay to the wallet row. Do not "fix" balances until you understand the cause. Ledger and audit tables have no UPDATE or DELETE grant, so a mismatch means one of these:
   - direct database access with an owner role;
   - a `wallets` row altered outside the wallet functions.
3. **Review access.** In `audit_log` for the window, look at:
   - `admin.*` entries, including `admin.break_glass_*`;
   - `wallet.admin_adjust`;
   - `config.*` and price book changes;
   - `account.*` entries.
4. **Supabase logs.** Look for unusual queries or roles.
5. **Decide scope.** Establish:
   - which accounts are affected;
   - which data classes (see [processing register](../compliance/processing-register.md));
   - whether any decrypted company data could have been read.

## 3. Recover

- **Wallet corrections.** Use admin credit adjustments with the incident id in the reason. Never edit `credit_ledger` or `wallets` directly.
- **Secrets.** Confirm every rotated secret is deployed and the old values no longer work.
- **Integrity.** Run `integrity-verify` manually and expect no alert:
  ```sh
  pnpm --filter @magicmis/worker start
  ```
  Then trigger the queue from pg-boss, or wait for the nightly run.

## 4. Notify

- **Affected account holders.** Explain what happened, which data, and what they should do. Use plain language, with no speculation.
- **Regulators and CERT-In.** Per the TODO above.
- **Subprocessors.** If the breach started with or affects them.

## 5. Afterwards

- Write a short incident record: timeline, cause, data affected, fixes, and what would have caught it sooner.
- Add a regression test or alert for the cause.
