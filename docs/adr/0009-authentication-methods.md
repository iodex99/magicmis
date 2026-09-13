# ADR 0009 — Email and password with mandatory TOTP; no social sign-in in this build

**Status:** accepted · **Date:** 2026-09-13 · **Phase:** 0

## Context

SPEC §8 says Google and Microsoft sign-in "may be offered" and requires the decision to be
recorded. The surrounding requirements constrain it:

- TOTP 2FA is mandatory; the app is unusable until it is enrolled, including after a first
  social login.
- Re-authentication for sensitive actions — changing email or password, regenerating backup
  codes, deleting a company or the account, exporting data — is defined as
  **password + TOTP**.
- Recovery without backup codes is a manual runbook proving control of the registered
  business email.
- SPEC §2.2: one login per account, one active session.

## Decision

**Email and password, with mandatory TOTP, is the only sign-in method in this build.** No
Google or Microsoft sign-in.

The reasons, in order of weight:

1. **The re-auth gate is defined as password + TOTP.** A social-only account has no
   password, so every sensitive action in SPEC §8 would need a second re-auth path invented
   outside the spec. Each extra path is somewhere the gate can be got wrong.
2. **Account identity stays under our control.** With social sign-in, the identity behind
   an account can change at the identity provider — an email address reassigned when
   someone leaves a firm, for example — which is exactly the case the manual recovery
   runbook is trying to be strict about.
3. **Smaller attack surface for Phase 1.** Account linking between a password identity and
   an OAuth identity with the same email is a known source of takeover bugs. Not having two
   identity kinds removes that class entirely.
4. **The usability gain is small for this audience.** Every session requires TOTP anyway, so
   social sign-in removes a password prompt but not the second factor.

**This is reversible.** Supabase Auth supports Google and Azure (Microsoft) providers, and
`accounts.auth_user_id` is provider-agnostic, so adding them later needs no schema change.

### Enforcing "unusable until 2FA is enrolled"

Supabase records the assurance level in the JWT's `aal` claim: `aal1` after a password,
`aal2` after a second factor. Phase 1 will enforce `aal2` in two places:

- in route handlers, before any customer data is served; and
- **in the database**, by extending `app.current_account_id()` to return NULL unless
  `auth.jwt() ->> 'aal' = 'aal2'`. Every tenant policy already calls it, so an `aal1`
  session sees nothing even if a route handler forgets the check.

## Verifying documentation

| Fact asserted | URL | Verified on |
|---|---|---|
| Supabase Auth supports TOTP ("App Authenticator") MFA | https://supabase.com/docs/guides/auth/auth-mfa | 2026-09-13 |
| AAL1 covers conventional sign-in including social sign-in; AAL2 means a second factor was verified; the level is in the JWT `aal` claim | same | 2026-09-13 |
| RLS can require AAL2 with `(select auth.jwt()->>'aal') = 'aal2'` | same | 2026-09-13 |
| Supabase Auth supports Google and Azure (Microsoft) providers | https://supabase.com/docs/guides/auth/social-login | 2026-09-13 |

Not confirmed from the pages checked: whether a provider can be enabled on an existing
project without side effects. Nothing is decided on that basis; it would be verified before
any future change to this ADR.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Offer Google and Microsoft alongside password | Requires a non-password re-auth path for every §8 sensitive action, plus account-linking rules. More surface in the phase that sets the security baseline. |
| Social sign-in only | Contradicts §8's password-based re-auth outright. |
| Passkeys | Not in SPEC §8. A reasonable future addition, but it would need the same re-auth redesign. |
| Phone OTP as the second factor | §8 specifies TOTP. SMS is also weaker against SIM swap. |

## Consequences

Easier: one identity kind, one re-auth path exactly as specified, and a recovery runbook that
only has to reason about email and TOTP.

Harder: users sign in with a password and a code rather than one click. Acceptable for a
desktop tool used for long working sessions on financial data.

**Carried into Phase 1:**

- The `aal2` check in `app.current_account_id()` changes a Phase 0 migration's behaviour, so
  it ships as a new migration, never an edit to `0002` (the runner's checksum check would
  refuse an edit anyway).
- The test auth shim must add `auth.jwt()` so the RLS harness can prove an `aal1` session
  reads nothing. ADR 0005's rule applies: implement only the documented contract, then
  confirm once against the real Supabase local stack.
