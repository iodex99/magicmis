# Runbook: account recovery without backup codes

**Owner:** support + an admin with account access · **SPEC:** §8 (recovery), §30

Use when a customer has lost both their authenticator app **and** their backup codes. If
they still hold a backup code, send them to **Sign in → Use a backup code** instead; that
path is self-service and needs none of this.

SPEC §8: there is no automated recovery that bypasses 2FA. Everything below is manual,
deliberately slow, and audited. The cost of a false recovery is a stranger holding a CA
firm's client financials, so when in doubt, refuse and escalate.

---

## 1. Take the request only from the registered email

- The request must arrive **from the email address on the account**. A request from any
  other address is refused, whatever it says — reply once, to the registered address
  only, stating that recovery must be requested from there.
- Never confirm or deny, to anyone other than the registered address, that an account
  exists.

## 2. Verify the business

Ask the requester to reply from the registered address with:

1. The **business name** and **billing address** exactly as on the account.
2. The **GSTIN** on the account, if one was provided at signup.
3. The **approximate date** the account was created and the **last successful sign-in**.
4. A **recent purchase**: the invoice number or amount of any credit pack bought.

Check each against the admin console (Accounts → profile, purchases, login events). Do not
reveal any of these values in your questions — ask the requester to supply them.

**Proceed only if all supplied details match.** One mismatch: refuse, record the attempt,
and do not say which detail was wrong.

## 3. Hold for 24 hours and notify

- Email the registered address: a recovery was requested, and if they did not request it
  they must reply within 24 hours to cancel.
- Record the request in the audit log (admin console → Accounts → Security →
  "Recovery requested", with a written reason). TODO(review): the admin action is built in
  Phase 9; until then record it with a service-role SQL insert into `audit_log`, and have a
  second admin witness it.
- Do nothing further for **24 hours**. A cancellation reply ends the process.

## 4. Reset the second factor

After the hold, with a second admin reviewing:

1. Remove the user's TOTP factors through the Supabase Auth admin API
   (`auth.admin.mfa.listFactors({ userId })`, then `deleteFactor({ id, userId })`). This
   also signs the user out of every session.
2. Revoke all remaining backup codes:
   `update backup_codes set revoked_at = now() where account_id = … and used_at is null and revoked_at is null`
   (as `service_role`).
3. Clear `accounts.active_session_id` for the account.
4. Record `auth.mfa_reset_by_admin` in the audit log with both admins' ids and the ticket
   reference. Metadata carries ids only, never the verification answers.

## 5. Tell the customer

Email the registered address: sign in with your password, and you will be asked to set up
a new authenticator app; new backup codes are issued when you do. Recommend changing the
password afterwards from Security settings.

## 6. Afterwards

- Watch the account's login events for 7 days. An unfamiliar new-device sign-in shortly
  after a recovery is the signature of a successful impersonation: suspend the account and
  escalate to the breach-response runbook.

## Never

- Never disable 2FA for an account, even temporarily.
- Never reset a factor on the strength of a phone call, a message from another address,
  or pressure about urgency.
- Never send a password, code or reset link to any address other than the registered one.
