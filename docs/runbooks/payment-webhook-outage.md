# Runbook: payment webhook outage

**Applies to:** credit purchases through Razorpay (SPEC §11, §13, ADR 0012, ADR 0013).

**Audience:** on-call engineers and the product owner.

Credits are granted **only** on a verified, de-duplicated webhook (`POST /api/webhooks/razorpay`). The browser callback only verifies the signature so the page can say "payment received"; it never grants credits.

If webhooks stop arriving, customers pay and see no credits.

## Razorpay behaviour (verified 2026-09-14)

- Any non-2xx response is a failed delivery.
- Failed webhooks are retried with exponential backoff for 24 hours.
- After 24 hours of failures the webhook is **disabled**. Razorpay emails the alert address. It must be re-enabled from the Dashboard after the fix.

Source: https://razorpay.com/docs/webhooks/faqs/ and https://razorpay.com/docs/webhooks/best-practices/.

Our handler returns:

| Response | When | Effect |
|---|---|---|
| 200 | processed or duplicate | Razorpay stops retrying |
| 401 | bad signature | Razorpay retries; see causes below |
| 400 | malformed | Razorpay retries |
| 413 | body over 1 MB | Razorpay retries |
| 500 | on error | Nothing is recorded, so a retry is safe |

## Symptoms

- Support messages: "paid but no credits".
- `purchases` rows stuck in `pending` or `paid` for more than 15 minutes:

  ```sql
  select id, account_id, status, razorpay_order_id, created_at from purchases
  where status in ('pending', 'paid') and created_at < now() - interval '15 minutes' order by created_at;
  ```

- A Razorpay "webhook disabled" email.

## Diagnose

1. **Delivery logs.** In the Razorpay Dashboard, go to Webhooks and check the recent deliveries and their response codes.
2. **401 responses** mean the signing secret no longer matches:
   - `RAZORPAY_WEBHOOK_SECRET` was rotated on one side only;
   - or the wrong environment's secret is set.
3. **5xx or timeouts:**
   - check the web deployment's function logs for `/api/webhooks/razorpay`;
   - check database connectivity;
   - check the Supabase status page.
4. **Nothing arriving at all:**
   - is the webhook disabled?
   - is the URL correct for this environment?
   - is `payment.captured` still among the subscribed events?

## Fix

1. Fix the cause: correct the secret and redeploy, or restore the database or deployment.
2. If Razorpay disabled the webhook, re-enable it in the Dashboard.
3. For events inside the 24-hour window, Razorpay's retries deliver them. The handler de-duplicates by event id, so nothing is credited twice.
4. For payments older than the retry window:
   - Confirm each stuck purchase is `captured` in the Razorpay Dashboard. Match on `razorpay_order_id`.
   - Do **not** use an admin credit adjustment for these payments. An adjustment grants credits without the purchase's tax invoice, and the purchase stays unreconciled.
   - Never insert ledger or invoice rows by hand.
   - Escalate to engineering to re-run the webhook grant path for that purchase (the same code that issues the invoice).

   > TODO(review): R-51 — build a reconciliation job that fetches payment status from the Razorpay API for stuck purchases and runs the webhook grant path. Until then, step 4 needs an engineer.
5. Tell affected customers their credits are now available.

## Prevent

- Set the Razorpay webhook alert address to the on-call mailbox.
- Rotate `RAZORPAY_WEBHOOK_SECRET` in Razorpay and in the deployment in the same change window.
