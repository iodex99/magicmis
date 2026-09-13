# ADR 0011 — Supabase Auth for credentials; SPEC §8 enforced by the product, twice

**Status:** accepted · **Date:** 2026-09-13 · **Phase:** 1

## Context

SPEC §8 asks for more than an identity provider offers: mandatory TOTP with the app
unusable until enrolled, a single active session per account, backup codes, re-auth gated
on password + TOTP, login history and new-device alerts, brute-force lockouts. SPEC §5 names
Supabase Auth for credentials. SPEC §6 does not list a package for account security.

## Decision

**Supabase Auth owns credentials**: password hashing, email verification, TOTP factors,
sessions, JWTs. **This product owns SPEC §8's additions**, in a new package,
`packages/accounts`, behind an `AuthProvider` interface so that the logic is tested against
real Postgres without a live Auth server. Adding a package beyond §6's list is within its
"build for extension" guidance; the Supabase adapter lives in `apps/web`.

The two properties that matter most are enforced in **two independent places**:

| Property | Database (migration 0012) | Application (`requireAccount`) |
|---|---|---|
| Unusable without 2FA | `app.current_account_id()` requires JWT `aal` = `aal2` | refuses `mfa_required` |
| One active session | requires JWT `session_id` = `accounts.active_session_id` | refuses `session_superseded` |

Route handlers connect as `service_role`, which bypasses RLS, so the application check is
the only guard on those paths. The database check guards everything reachable through the
publishable key and PostgREST. Neither alone covers both.

Further decisions:

- **Session claim writes the database before calling the provider.** The DB write is what
  cuts off the old session; `signOut({ scope: 'others' })` then removes its refresh token. A
  failed provider call still leaves the old tab refused on its next request (tested).
- **A backup code never grants access.** It removes the TOTP factors; the user signs in
  again and enrols a new authenticator. Consuming the code and removing the factors happen
  in one transaction, so a provider failure leaves the code usable (tested). The installed
  SDK documents that deleting a verified factor signs the user out everywhere, which the
  recovery flow relies on.
- **Re-auth evaluates both factors every time**, so response timing does not reveal which
  failed, and grants a window bound to the session id, so a grant is useless on any other
  session.
- **Server connections set `role=service_role` as a startup parameter**, so the append-only
  revokes from migration 0011 bind server code as well as the triggers.
- **Idempotency-Key** is enforced on mutating endpoints (migration 0013). Responses that carry
  a secret — freshly issued backup codes — are recorded without a body and never replayed,
  so the codes are never persisted in plaintext.
- **Email verification uses a token-hash link**, not the default PKCE link. The PKCE code
  can only be exchanged by the browser holding the verifier cookie; a CA who opens the email
  in a different browser would otherwise fail verification.
- **Supabase's current key types** (`sb_publishable_…`, `sb_secret_…`) are required by the env
  schema; the legacy JWT keys are rejected.

## Verifying documentation

| Fact asserted | URL | Verified on |
|---|---|---|
| JWT claims `session_id`, `aal`, `amr` | https://supabase.com/docs/guides/auth/jwt-fields | 2026-09-13 |
| `signOut({ scope: 'others' })` | https://supabase.com/docs/reference/javascript/auth-signout | 2026-09-13 |
| TOTP enrol/challenge/verify/listFactors/AAL APIs | https://supabase.com/docs/guides/auth/auth-mfa/totp | 2026-09-13 |
| Server code verifies with `getClaims()`, never `getSession()` | https://supabase.com/docs/guides/auth/server-side/nextjs | 2026-09-13 |
| `getClaims(jwt?)`, `admin.mfa.listFactors({userId})`, `admin.mfa.deleteFactor({id,userId})` and its sign-out-everywhere behaviour | `@supabase/auth-js` 2.116.0 installed type definitions (reference page returned 404) | 2026-09-13 |
| Publishable/secret keys; legacy keys deprecated end of 2026 | https://supabase.com/docs/guides/api/api-keys | 2026-09-13 |
| Local `postgres` role: not superuser, BYPASSRLS, member of `service_role` | queried `pg_roles` on the Supabase local stack (CLI 2.117.0) | 2026-09-13 |
| Real `auth.uid()` / `auth.jwt()` bodies | `pg_get_functiondef` on the Supabase local stack; the test shim now copies them | 2026-09-13 |
| Next.js 16 `proxy.ts`, Node runtime by default | https://nextjs.org/docs/app/api-reference/file-conventions/proxy | 2026-09-13 |

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Enforce aal2 and single session only in route handlers | Anything reachable with the publishable key would be unprotected. |
| Enforce only in RLS | Server routes use `service_role` and bypass RLS entirely. |
| A Supabase custom access-token hook to embed account state in the JWT | Tokens live up to an hour; a superseded session would keep working until expiry. SPEC §8 wants the old tab refused immediately. |
| Let a backup code produce an aal2 session | Supabase cannot mint aal2 without a factor; faking it would put a bypass of 2FA into the product. |
| Supabase's own reauthentication nonce for sensitive actions | It emails a nonce; SPEC §8 specifies password + TOTP. |

## Consequences

Every authenticated request does one indexed account lookup. Acceptable, and it is what makes
"signed out because this account signed in elsewhere" immediate rather than eventual.

Signing in on a second device is a deliberate, visible act, which suits a single-login
product (SPEC §2.2) but will generate support questions from users with two browsers open.
The signed-out page explains why.
