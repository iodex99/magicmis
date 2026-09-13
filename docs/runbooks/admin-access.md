# Runbook — admin access

**Applies to:** `apps/admin` (SPEC §26, ADR 0015). **Audience:** the product owner and on-call engineers.

## Principles

- Admin identity is separate from customer accounts. No Supabase Auth user is ever an admin.
- An admin must be on `ADMIN_ALLOWED_EMAILS` (deployment environment, not the database) **and**
  have an active `admin_users` row. Removing an email from the allowlist revokes access at the
  next request, even with a live session.
- Every sign-in, failed sign-in, sign-out and admin action is in `audit_log`.

## Add an admin

1. Add the email to `ADMIN_ALLOWED_EMAILS` for the admin deployment and redeploy.
2. From a trusted machine with production database access and the KMS role:
   ```sh
   ADMIN_EMAIL=person@company.example pnpm --filter @magicmis/admin create-admin
   ```
   The password (minimum 14 characters) is read from the prompt, never from arguments.
3. The script prints an `otpauth://` URI **once**. The new admin adds it to an authenticator app
   immediately, in person or over a call — never paste it into chat or email.
4. The admin signs in at the admin subdomain and confirms it works.
5. Check `/audit` for `admin.created` and `admin.login`.

## Remove an admin

1. Remove the email from `ADMIN_ALLOWED_EMAILS` and redeploy (immediate lock-out).
2. `update admin_users set status = 'disabled' where lower(email) = '<email>';`
3. `update admin_sessions set revoked_at = now() where admin_id = '<id>' and revoked_at is null;`
4. Record the reason in the change log.

## Lost authenticator or password

There is no self-service reset. Treat as remove-then-add: disable the row, create a new admin
row for the same email with `create-admin` (delete the disabled row first), and verify identity
out of band before handing over the new TOTP URI.

## Locked out

`admin.login_max_failures` failures within `admin.login_lockout_seconds` (config) lock the email.
The lock clears when the window passes; a successful sign-in resets the count. Repeated lockouts
for an email nobody is using are an attack signal: review `admin.login_failed` entries by IP.

## IP allowlist

Optional `ADMIN_IP_ALLOWLIST` (comma-separated). When set, requests from other IPs are refused
before any session lookup. Keep an emergency path (e.g. a bastion IP) in the list.
