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

## 3. Record the request (starts the hold)

In the admin console, open **Accounts → the account → Account recovery** and fill in:
- the **ticket reference**;
- **what was verified** (20 to 500 characters): which details matched, never the answers themselves;
- your **authenticator code**.

**Request recovery** records `auth.recovery_requested` in the audit log and emails the registered address (`security.recovery_requested`): a reset was requested, nothing changes before the hold ends, and they must reply to cancel if they did not ask. The hold is `admin.recovery_hold_hours` (config, default 24).

- A cancellation reply ends the process: press **Cancel request** (`auth.recovery_cancelled`).
- Only one open request per account is allowed.

## 4. Remove the second factor (after the hold)

With a second admin reviewing (required by the console when `admin.recovery_second_admin` is on):

1. Open the same panel and enter your authenticator code on the open request. **Remove second factor** is refused before the hold ends, and, with the two-admin rule on, refused for the admin who made the request.
2. In one step, the console:
   - removes the user's TOTP factors through the Supabase Auth admin API (`auth.admin.mfa.listFactors`, `deleteFactor`), which needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` in the admin environment;
   - revokes every unused backup code;
   - ends the active session;
   - records `auth.mfa_reset_by_admin` with the ticket, the requesting and completing admins, and the number of factors removed (ids only, never the verification answers);
   - emails the registered address (`security.mfa_reset_by_admin`) with sign-in instructions.

## 5. Tell the customer

The console emails the registered address automatically. If they reply with questions: sign in
with your password, and you will be asked to set up a new authenticator app; new backup codes
are issued when you do. Recommend changing the password afterwards from Security settings.

## 6. Afterwards

- Watch the account's login events for 7 days. An unfamiliar new-device sign-in shortly
  after a recovery is the signature of a successful impersonation: suspend the account and
  escalate to the breach-response runbook.

## Never

- Never disable 2FA for an account, even temporarily.
- Never reset a factor on the strength of a phone call, a message from another address,
  or pressure about urgency.
- Never send a password, code or reset link to any address other than the registered one.
