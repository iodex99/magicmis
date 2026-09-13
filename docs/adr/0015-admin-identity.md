# ADR 0015 — Admin identity separate from customer auth

**Status:** accepted · **Date:** 2026-09-13 · **Phase:** 2

## Context

SPEC §26: a separate admin app on a separate subdomain with separate auth — allowlisted emails,
mandatory TOTP, short sessions, optional IP allowlist — and every action audit-logged.

## Decision

Custom, small, fully tested identity in `apps/admin/src/server`, not Supabase Auth:

- **Allowlist in the deployment environment** (`ADMIN_ALLOWED_EMAILS`), checked at sign-in *and on
  every request*. A database write cannot mint an admin; removing an email ends live sessions.
- **Passwords: scrypt** (node:crypto) with N=2^17, r=8, p=1 — OWASP's minimum — parameters stored
  per hash. Minimum 14 characters. A dummy hash is verified for unknown emails so timing does not
  reveal which emails exist; every credential failure returns the same message.
- **TOTP: RFC 6238** (HMAC-SHA1, 6 digits, 30 s, ±1 step) implemented with node:crypto and tested
  against the RFC's Appendix B vectors. The last accepted time step is stored and the admin row is
  locked during verification, so a code cannot be replayed, even concurrently.
- **TOTP secrets encrypted** with envelope encryption (packages/crypto, ADR 0008), encryption
  context `{purpose: admin_totp, admin_id}`. `KEY_WRAPPER=local` is refused outside
  `APP_ENVIRONMENT=development`.
- **Sessions:** 32 random bytes in an httpOnly, SameSite=Strict cookie (`__Host-` prefixed and
  Secure outside development); only its SHA-256 is stored. Idle and absolute expiry from config
  (30 min / 8 h seeded). Sign-out revokes server-side.
- **Lockout:** failures within `admin.login_lockout_seconds` since the later of the window start,
  last successful sign-in or admin creation; refusals while locked do not extend the lock.
- **Mutations** are Next.js server actions (framework origin checks) that call `requireAdmin()`
  themselves and delegate to server functions that audit in the same transaction as the change.

Supabase Auth was not used because admin and customer identities must not share a user pool,
session cookies or recovery flows; a second Supabase project for a handful of admins adds an
external dependency and still needs the allowlist and audit logic here.

## Verifying documentation

| Fact asserted | URL | Verified on |
|---|---|---|
| scrypt minimum parameters N=2^17, r=8, p=1 | https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html | 2026-09-13 |
| HOTP truncation, 160-bit secret recommendation | https://www.rfc-editor.org/rfc/rfc4226 | 2026-09-13 |
| TOTP time steps, skew window, one-time use, Appendix B test vectors | https://www.rfc-editor.org/rfc/rfc6238 | 2026-09-13 |
| `__Host-` cookie prefix semantics | https://httpwg.org/http-extensions/draft-ietf-httpbis-rfc6265bis.html | 2026-09-13 |

## Consequences

- No self-service recovery for admins; see `docs/runbooks/admin-access.md`.
- Break-glass access to decrypted customer data (SPEC §26) is not built yet (Phase 9).
