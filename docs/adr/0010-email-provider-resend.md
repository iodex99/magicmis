# ADR 0010 — Resend for email (supersedes ADR 0007)

**Status:** accepted · **Date:** 2026-09-13 · **Phase:** 0 · **Supersedes:** [0007](0007-email-provider.md)

## Context

ADR 0007 chose Postmark after the email-provider choice was delegated. On review the product
owner overruled that choice and directed Resend, which SPEC §5 lists as one of its two
permitted options. This ADR records that decision and the engineering constraints that
follow from it. ADR 0007 is kept unedited, marked superseded, so the history of the choice
stays readable.

The requirements from 0007 still stand: every SPEC §29 email is transactional, several are
security or lifecycle warnings, and no email may carry financial figures from customer data.

## Decision

Resend, via its official Node SDK (`resend`), for every email the product sends, including
Supabase Auth's verification and password-reset mail through custom SMTP.

Implementation rules:

- **Always inspect `{ data, error }`.** The SDK reports failure in the return value, not by
  throwing. A sender that only wraps the call in `try/catch` would treat every failed send
  as delivered — and a silently undelivered "your company will be archived" notice is
  exactly the failure SPEC §28 cannot afford.
- **Send with `idempotencyKey`**, derived from the `notifications` row (e.g.
  `notification:<id>`). A worker retry after a timeout then cannot deliver a security or
  billing notice twice. The key expires after 24 hours, which comfortably covers retries.
- **Sending subdomain** with its own DNS authentication, separate from the root domain.
- **Delivery events via webhook**, de-duplicated by the `svix-id` header, per Resend's
  guidance, and consistent with SPEC §4's rule that webhooks are de-duplicated by event id.
  Bounces and complaints mark the `notifications` row and suppress further sends to that
  address.
- The sender sits behind a `MailSender` interface in the worker, so tests use a recording
  fake and never call Resend.

Server env: `RESEND_API_KEY` (validated shape `re_…`) and `EMAIL_FROM`.

## Verifying documentation

| Fact asserted | URL | Verified on |
|---|---|---|
| Package `resend`; `new Resend(apiKey)`; `resend.emails.send({ from, to, subject, html, text, headers, tags, ... })` | https://resend.com/docs/send-with-nodejs | 2026-09-13 |
| `emails.send` returns `{ data, error }` rather than throwing on failure | same | 2026-09-13 |
| `idempotencyKey` is supported per request and expires after 24 hours | same | 2026-09-13 |
| Webhook events include `email.sent`, `email.delivered`, `email.bounced`, `email.complained`; duplicates are identified by the `svix-id` header | https://resend.com/docs/dashboard/webhooks/introduction | 2026-09-13 |
| Resend sending regions: us-east-1, eu-west-1, sa-east-1, ap-northeast-1; none in India | https://resend.com/docs/dashboard/domains/regions | 2026-09-13 |
| Supabase's built-in mailer is non-production (2 messages/hour, team addresses only); custom SMTP is urged | https://supabase.com/docs/guides/auth/auth-smtp | 2026-09-13 |

**Not verified from the pages checked:** the exact webhook signature-verification API. The
webhook route will not be written until that is confirmed against Resend's webhook
verification documentation, per SPEC §0.4.

## Alternatives considered

| Alternative | Why not chosen |
|---|---|
| Postmark (ADR 0007) | Overruled by the product owner. |
| Amazon SES | Deliverability, suppression and reputation management become our work. |
| Supabase built-in mail | Non-production. |

## Consequences

The sending region is chosen at domain setup in Resend. None is in India. `ap-northeast-1`
(Tokyo) is the nearest of the four, and is the default for this project. Nothing in any
email is customer financial data, so region is a latency choice, not a residency one.

The Phase 9 privacy notice must list Resend as a subprocessor.

The `{ data, error }` contract and the idempotency key are enforced by tests on the
`MailSender` implementation, not left to convention.
