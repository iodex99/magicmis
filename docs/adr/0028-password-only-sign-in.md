# ADR 0028: Customer sign-in is password-only

**Status:** accepted · **Date:** 2026-09-15 · **Decided by** the product owner · **Supersedes** the mandatory-2FA rule in SPEC §8 and the 2FA part of [0009](0009-authentication-methods.md)

## Context

The product owner, pursuing the friction work in [0027](0027-friction.md), judged that 2FA
was not needed for customer login.

This ADR records that the decision was taken with the trade-off stated, because the
reasoning matters more than the outcome if it is ever revisited.

**The advice given, and not taken.** Three options were put: defer enrolment until the
first upload or purchase (keeping 2FA required where data and money are), make it optional,
or remove it. Deferring was recommended: it removes the wall at first contact, which was the
actual friction, while losing no protection at the point where an account holds a CA firm's
client financial data and a prepaid credit balance. The owner chose removal. It is their
product and their risk to carry; the job here is to implement it well rather than
half-heartedly.

**What that costs, plainly.** A single leaked or reused password is now sufficient to reach
a firm's trial balances, ledgers, party names and stored company memory, and to spend its
credits. Credential stuffing against this login now has a payoff it did not have before.
The DPDP Act's "reasonable security safeguards" obligation (§31) is a judgement call, and
this moves the product away from the strongest available answer.

**What did not change.** The admin console keeps mandatory TOTP (§26). It is the operator
surface with break-glass access to customer data, and its threat model is not the
customer's.

## Decision

Remove the customer's second factor and everything that existed to support or recover it.

### What went

- TOTP enrolment, verification, and the QR/secret screens.
- Backup codes: issue, regeneration, redemption, the `backup_codes` table.
- The `/sign-in/mfa`, `/sign-in/enrol` and `/sign-in/recover` screens and their endpoints.
- The admin-operated account-recovery flow (R-21) and the `account_recoveries` table. Its
  only purpose was resetting a lost authenticator; with no authenticator it is dead code,
  and a table nobody can write to is a worse record than none.
- The `security.mfa_reset_with_backup_code`, `security.backup_codes_regenerated`,
  `security.recovery_requested` and `security.mfa_reset_by_admin` notices.
- The Supabase Auth admin access the admin console needed only for factor removal.

### What now carries the weight

Removing a factor makes the remaining controls load-bearing, so each was checked rather
than assumed:

- **Single active session** (unchanged). A new sign-in claims the session and the previous
  one is refused on its very next request. This now happens at the password step, since
  there is no later step to do it at.
- **Throttling** (unchanged, now critical). Sign-in counts failures per IP **and** per
  email — the email hashed, so `auth_throttle` never becomes a list of addresses people
  tried — and locks on the configured limit. This is what stands between a leaked password
  list and an account.
- **Re-authentication before anything irreversible** (narrowed to the password): data
  export, account deletion, company deletion, password and email changes. Asked every time,
  never remembered beyond its short session-bound window, throttled with its own lockout.
- **Login history and new-device email alerts** (unchanged). With no second factor these
  are the customer's own detection mechanism, which is an argument for keeping them
  prominent rather than tidying them away.

### Migration

`0035_password_only_sign_in.sql` drops `backup_codes` and `account_recoveries`, and deletes
the `admin.recovery_*` config keys. Both tables are pre-launch and hold no customer data.
`admin.break_glass_*` keys stay: break-glass is unrelated.

## Consequences

- **The sign-in journey is one screen.** Sign up (four fields) → confirm email → in. The
  confirmation link already established the session, so it now lands on `/app` rather than
  on authenticator setup.
- **`requireAccount` lost its `mfa_required` refusal**, and `claimSession` no longer
  requires `aal2`. The `aal` claim is still parsed — Supabase still sends it — but nothing
  gates on it.
- **Tests changed where the behaviour changed.** The E2E helper no longer enrols;
  `auth.spec.ts`'s "app is unusable without 2FA" became "an unauthenticated visitor reaches
  no data", which is what the gate now asserts; `privacy.spec.ts` re-authenticates with a
  password; the backup-code unit and integration suites went with the feature.
- **Reversing this is not symmetrical.** Re-introducing mandatory 2FA later means enrolling
  an existing population, which is a migration and a support burden rather than a code
  change. Recorded as **R-58** so the decision is revisited deliberately, if at all.
