# Phase 1 — Accounts and security

Scope from SPEC §34:

> - Signup, email verification, login, mandatory TOTP, backup codes, single active
>   session, login events, new-device email.
> - Re-auth gates, account settings, consent records, desktop-only gate.
> - *Acceptance:* E2E auth flows pass; second login terminates the first session; app
>   unusable without 2FA.

Review gates between phases were waived by the product owner on 2026-09-13 ("build
everything now"). Plans, summaries and ADRs are still written per phase.

## Design

Supabase Auth owns credentials: password hashing, email verification, TOTP factors,
sessions and JWTs. This product owns everything SPEC §8 adds on top, in a new
`packages/accounts` package, behind an `AuthProvider` interface so the logic is testable
against real Postgres without a live Auth server.

| Concern | Where it is enforced |
|---|---|
| Unusable without 2FA | `app.current_account_id()` returns NULL unless the JWT `aal` is `aal2` (migration 0012), **and** `requireAccount()` in every route handler. |
| Single active session | `accounts.active_session_id` must equal the JWT `session_id`, checked in the same two places. A new login claims the session and calls `signOut({ scope: 'others' })`. |
| Backup codes | 10 codes, scrypt-hashed with per-code salt, single use. Redeeming one removes the TOTP factors via the admin API so the user can re-enrol; it never mints an `aal2` session by itself. |
| Re-auth gates | Password (verified with a throwaway, non-persisted client whose session is revoked immediately) plus a fresh TOTP verify on the user's own session. Grants a short-lived, session-bound `reauth_grants` row. |
| Brute force | `auth_throttle` table: fixed window counts and lockouts per key (account, IP). Supabase's own auth rate limits stay on as well. |
| Login events + new device | `login_events` with a device fingerprint hash; the first login from an unseen fingerprint queues a `new_device_login` notification. |
| Consents | `consents` rows at signup (terms, privacy) with version and IP. |
| Desktop only | `proxy.ts` user-agent check on app routes; marketing routes stay responsive. |

## Tasks

1. Migration `0012_accounts_security.sql`: `backup_codes`, `reauth_grants`,
   `auth_throttle`; replace `app.current_account_id()` to require `aal2` and the active
   session; RLS and grants for the new tables.
2. Test shim gains `auth.jwt()` (documented contract only), harness sets `aal` and
   `session_id` claims; RLS suite proves an `aal1` token and a stale session read nothing.
3. `packages/accounts`: signup provisioning, GSTIN/state validation, session claim,
   `requireAccount`, backup codes, re-auth, throttle, login events and new-device
   detection, consent recording, audit entries for every auth event.
4. `apps/web`: Next.js 16 App Router, Tailwind, `@supabase/ssr`; `proxy.ts` for session
   refresh and the desktop gate; auth pages (sign up, verify email, sign in, TOTP
   enrolment, backup codes, recovery information); account settings (profile, GSTIN,
   billing address, security, login history); route handlers for every mutation, each
   taking an `Idempotency-Key` where it mutates.
5. Supabase local stack config (`supabase/config.toml`): email confirmations on, TOTP on,
   SMTP through Resend; migrations synced from `packages/db/migrations`.
6. Playwright E2E against the local stack: sign up → verify email (Mailpit) → enrol TOTP
   → sign in; second login terminates the first; data routes refuse `aal1`.

## Tests

- Unit: backup code generation/format/verification, throttle windows, device
  fingerprinting, desktop user-agent detection, `requireAccount` decision table.
- Integration (Testcontainers): provisioning is idempotent; session claim; re-auth grant
  expiry and session binding; backup codes single-use under concurrency; RLS denies
  `aal1` and stale sessions.
- E2E (Playwright + Supabase local): the three acceptance criteria.

## External facts verified (2026-09-13)

| Fact | Source |
|---|---|
| JWT carries `session_id`, `aal` (`aal1`/`aal2`), `amr` `[{method, timestamp}]` | https://supabase.com/docs/guides/auth/jwt-fields |
| `signOut({ scope: 'others' })` signs out all other sessions, keeps the current | https://supabase.com/docs/reference/javascript/auth-signout |
| TOTP API: `mfa.enroll`, `challenge`, `verify`, `listFactors`, `getAuthenticatorAssuranceLevel` | https://supabase.com/docs/guides/auth/auth-mfa/totp |
| RLS can require `(select auth.jwt()->>'aal') = 'aal2'` | https://supabase.com/docs/guides/auth/auth-mfa |
| Server code must verify with `getClaims()`, never trust `getSession()` | https://supabase.com/docs/guides/auth/server-side/nextjs |
| Next.js 16 renames `middleware` to `proxy.ts`, Node runtime by default | https://nextjs.org/docs/app/api-reference/file-conventions/proxy |
| New projects use `sb_publishable_`/`sb_secret_` keys; legacy keys deprecated by end of 2026 | https://supabase.com/docs/guides/api/api-keys |
| CLI as dev dependency; local ports 54321 API, 54322 DB, 54323 Studio, 54324 Mailpit | https://supabase.com/docs/guides/local-development/cli/getting-started |
| `config.toml`: `auth.mfa.totp.enroll_enabled/verify_enabled`, `auth.email.enable_confirmations`, `auth.email.smtp.*`, `auth.rate_limit.*` | https://supabase.com/docs/guides/local-development/cli/config |

Admin MFA factor deletion: the reference page returned 404; its signature is taken from
the installed `@supabase/auth-js` type definitions and cited there.

---

# Phase 1 summary

**Status: complete.** Review gate waived by the product owner (2026-09-13); work continues
into Phase 2.

## Acceptance criteria (§34)

| Criterion | Result |
|---|---|
| E2E auth flows pass | **Met.** Playwright against the real Supabase local stack (Auth, Mailpit, Postgres) and a production build: sign up → verify email → enrol TOTP → backup codes → app. |
| Second login terminates the first session | **Met.** Two browser contexts; the first is refused with `session_superseded` on its next API call and its page shows "You were signed out because this account signed in elsewhere." |
| App unusable without 2FA | **Met.** At aal1, `/app` redirects to MFA and every data API returns `mfa_required`. The database refuses aal1 independently (RLS tests). |

## Tests

| Suite | Count |
|---|---|
| `@magicmis/core` | 145 |
| `@magicmis/db` (RLS incl. aal2 / stale-session refusals, idempotency, constraints, audit chain) | 62 |
| `@magicmis/accounts` (unit + real-Postgres flows) | 48 |
| `@magicmis/ui` | 15 |
| `@magicmis/web` E2E | 5 |
| **Total** | **275** |

## Built

- Migration 0012: aal2 + active-session tenancy predicate; backup codes, re-auth grants,
  throttle; config defaults. Migration 0013: idempotency keys; sign-in throttle config.
- `packages/accounts`: provisioning, session claim, `requireAccount`, backup codes,
  re-auth, throttle, device fingerprinting, desktop gate, notifications queueing.
- `apps/web`: Next.js 16 with `proxy.ts`; 15 API routes; sign-up, verification, sign-in,
  enrolment, MFA, recovery, signed-out, desktop-required, app shell, security and profile
  settings.
- Supabase local configuration, token-hash confirmation template, migration mirroring script.
- CI: E2E job running Supabase local + Playwright; migration-mirror check.
- Runbook: account recovery without backup codes.

## Found and fixed along the way

1. **The test auth shim diverged from Supabase.** Comparing against `pg_get_functiondef`
   on the real stack: `auth.jwt()` returns NULL with no claims, the shim returned `{}`.
   No test outcome changed (policies use `coalesce`), but the shim now copies the real bodies.
2. **Turbopack cannot resolve `.js` specifiers onto `.ts` sources** — ADR 0012.
3. **`set role` in the pool's connect handler raced the first query.** Replaced with a
   startup parameter; verified that DELETE on `credit_ledger` is then refused at the
   privilege level for server code.
4. **Backup-code normaliser folded O→0 and I/L→1, but the alphabet contains none of them**,
   so folding could only turn a typo into a certain failure. Removed.
5. **Default PKCE email link only verifies in the browser that signed up.** Switched to a
   token-hash template.
6. **A string replacement corrupted a source file** (`$\`` in a JS `replace` replacement
   string). Rewritten; replacement scripts are no longer used on code.

## Decisions (ADRs)

- 0010 Resend (supersedes 0007 Postmark) — product owner's direction.
- 0011 Accounts architecture: Supabase Auth for credentials; SPEC §8 enforced in DB and app.
- 0012 Extensionless internal imports.

## New dependencies (§0.10)

| Dependency | Justification |
|---|---|
| `next`, `react`, `react-dom` | SPEC §5 web stack. |
| `@supabase/ssr`, `@supabase/supabase-js` | SPEC §5 Auth; the SSR package is Supabase's documented Next.js integration. |
| `tailwindcss`, `@tailwindcss/postcss` | SPEC §5 styling. |
| `supabase` (CLI, dev) | Local stack for E2E and migration verification against real Supabase. |
| `@playwright/test` (dev) | SPEC §5 E2E. |
| `otpauth` (dev) | Generates TOTP codes in E2E the way an authenticator app does. |
| `server-only` | Build-time guarantee that server modules (DB pool, secret key) never enter a client bundle. |

**Not yet used, deviation noted:** SPEC §5 names shadcn/ui for primitives. Phase 1's forms
use small in-repo components styled with the §32 tokens. shadcn/ui is adopted when the
dense table and dialog work of Phases 2–6 arrives; recorded here so it is not forgotten.

## `TODO(review)` raised this phase

- **R-01** Product name: a placeholder, "MIS Studio", is set in `apps/web/src/lib/brand.ts`
  (§32 rules out the repository's "magic" name for customer copy).
- **R-10 / R-11** Terms and Privacy pages are placeholders; consent records use document
  version `0.1-draft` from `app_config`.
- **R-21** Runbook step recording an admin MFA reset uses a witnessed SQL insert until the
  Phase 9 admin console provides the action.
- **R-22** Production Supabase project must mirror `supabase/config.toml`: confirmations on,
  TOTP on, 12-character mixed passwords, secure password change, Resend SMTP, and the
  token-hash confirmation template.
