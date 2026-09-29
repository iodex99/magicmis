# 0073 — Auth email that reaches customers

- **Status:** accepted
- **Date:** 2026-09-29
- **Decided by:** the product owner ("check whether we have set up email support for the forgot
  password flow, if not we need to build that too")
- **Advances:** R-22. Follows [0010](0010-email-provider-resend.md), which chose Resend and noted
  Supabase's own mailer is not for production.

## Context

The forgot-password flow is built and tested end to end: the request (throttled, and silent about
whether an address has an account), the token-hash link that signs nobody in (ADR 0043, ADR 0057),
and the form that spends the token together with the new password. Locally and in CI every email
goes to Mailpit, so the tests pass.

Production is where it would have failed. Nothing configured the hosted project's email, and
Supabase's own mailer sends only to the project team's addresses, two an hour — every customer's
reset and every sign-up confirmation would fail with "Email address not authorized". The customer
would be told to check their email, and nobody would know: the reset request never looked at the
result of the send.

Verified 2026-09-29:

| Fact | Source |
|---|---|
| Built-in mailer: team addresses only, 2 an hour; with custom SMTP, 30 an hour until raised | <https://supabase.com/docs/guides/auth/auth-smtp> |
| Resend SMTP: host `smtp.resend.com`, user `resend`, the API key as password, 465 implicit TLS; a verified domain is required | <https://resend.com/docs/send-with-smtp> |
| `PATCH /v1/projects/{ref}/config/auth` and its fields (`smtp_*`, `rate_limit_email_sent`, `site_url`, `uri_allow_list`, `mailer_autoconfirm`, `mailer_subjects_*`, `mailer_templates_*_content`, `password_min_length`, `security_update_password_require_reauthentication`) | <https://supabase.com/docs/reference/api/v1-update-auth-service-config>, <https://supabase.com/docs/reference/api/v1-get-auth-service-config> |
| Management API authentication: `Authorization: Bearer <personal access token>` | <https://supabase.com/docs/reference/api/introduction> |

The CLI configuration reference documents `[auth.email.smtp]` for the local stack but not a command
that pushes it to a hosted project, so this does not rely on one.

## Decision

1. **One command sets and checks production Auth email.** `pnpm --filter @magicmis/accounts
   auth-email` reads the project's auth configuration through the Management API and lists
   everything that would stop, slow or misdirect a customer's email; `--apply` sets it and checks
   again. The judgement is pure code in `packages/accounts/src/auth-email.ts`, unit-tested in CI;
   the command only talks to the API and never prints a secret.
2. **Production cannot drift from what is tested.** The templates and subjects come from
   `supabase/templates` and `supabase/config.toml`, the minimum password length from the same file,
   the sender name from the product name. A test fails if a template stops being the token-hash
   kind the flows rely on.
3. **A failed send is logged.** The reset request and the sign-up log Supabase's error code — never
   the address — when an email cannot be sent, so a missing SMTP setting, a too-low hourly limit or
   a rejected sender shows in the logs rather than as customers who silently never hear back.
4. **What the command does not set** is the password character rule, because the documentation does
   not show that field's exact value for mixed case and digits; the runbook sets it in the
   dashboard, and the product's own validation enforces it meanwhile.

## Consequences

- R-22 needs three things only the owner has: the sending domain (R-01), a Resend account with it
  verified, and the production project. Then it is one command ([runbook](../runbooks/auth-email.md)).
- `AUTH_EMAILS_PER_HOUR` is a real ceiling on sign-ups and resets together; the runbook starts it at
  100 and says how to see it being hit.

## Tests

`packages/accounts/test/auth-email.test.ts`: the repository's own templates pass and a default
Supabase template does not; unusable settings are refused before anything is sent; the change sets
Resend's SMTP, the sender, the templates and confirmation on; a project holding it has no problems;
a fresh project is told plainly why customers get nothing; and each setting that drifts on its own
is caught with its own message.
