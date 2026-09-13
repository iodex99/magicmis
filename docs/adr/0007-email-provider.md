# ADR 0007 — Postmark for email

**Status:** superseded by [ADR 0010](0010-email-provider-resend.md) on 2026-09-13 (product owner chose Resend) · **Date:** 2026-09-13 · **Phase:** 0

## Context

SPEC §5: "Resend or Postmark (pick one; record in ADR)". SPEC §29 makes this build
email-only, and every message on the list is transactional: new-device login alerts, 2FA
changes, break-glass admin access notices, purchase invoices, lot expiry, memory fee
failures, grace/archive/purge warnings, job completion. There is no marketing mail.

Several of those messages carry consequences if they arrive late or land in spam. A user
who never sees "your company will be archived in 7 days" loses their company memory. A user
who never sees a new-device alert may not notice an account takeover.

Phase 0's plan said I would proceed with Resend unless told otherwise. The choice was then
delegated, so it was made on the merits instead, and the merits favour Postmark.

## Decision

Postmark, sending only on a **transactional** message stream (`outbound`, the default),
with a custom DKIM and Return-Path on a dedicated sending subdomain.

Configuration: `POSTMARK_SERVER_TOKEN`, `POSTMARK_MESSAGE_STREAM` (default `outbound`) and
`EMAIL_FROM` in the server env schema. The token is server-only (SPEC §30).

Templates follow SPEC §29: plain, branded, and carrying **no financial figures from
customer data**. That keeps customer financial information out of a third party's
retention, whatever that retention is.

## Verifying documentation

| Fact asserted | URL | Verified on |
|---|---|---|
| Postmark separates traffic into message streams; broadcast traffic uses dedicated infrastructure "so transactional delivery stays fast and reliable" | https://postmarkapp.com/support/article/1207-how-to-create-and-send-through-message-streams | 2026-09-13 |
| Postmark recommends transactional and broadcast on separate streams and subdomains with custom DKIM and Return-Path | same | 2026-09-13 |
| Resend sends from us-east-1, eu-west-1, sa-east-1 and ap-northeast-1; no India region | https://resend.com/docs/dashboard/domains/regions | 2026-09-13 |
| Resend supports both transactional and marketing email | same | 2026-09-13 |
| Supabase's default email is "best-effort only … for non-production use", limited to 2 messages/hour and to team-member addresses; Supabase urges custom SMTP and lists Postmark among providers | https://supabase.com/docs/guides/auth/auth-smtp | 2026-09-13 |

Postmark's default data retention period could not be confirmed: the support article
checked returned 404. The decision does not depend on it, because no email carries
customer financial data (SPEC §29). It is a question for the privacy notice in Phase 9.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Resend | A good API, and its React Email tooling is pleasant. But that ergonomic advantage matters little for deliberately plain templates, and Resend has no India region either, so region does not break the tie. Postmark's structure is built around keeping transactional delivery isolated from broadcast traffic, which is the property this mail list needs. |
| Amazon SES in `ap-south-1` | Keeps mail in-region and is cheapest at volume, but deliverability, bounce handling, suppression lists and reputation management become our work. That is the wrong trade for a product whose most important emails are security and lifecycle warnings. |
| Supabase Auth's built-in email | Not a production option: best-effort, 2 messages an hour, and deliverable only to the project team's own addresses. It also covers auth emails only. |

## Consequences

Easier: one provider for all SPEC §29 mail, and security notices go out on a stream that
never carries bulk traffic.

Harder: email leaves India. Acceptable given nothing in it is customer financial data, but
the Phase 9 privacy notice must list Postmark as a subprocessor.

Supabase Auth's own emails (verification, password reset) must be routed through Postmark
via custom SMTP in Phase 1, so every email the product sends comes from one domain and one
reputation.

Resend remains a like-for-like fallback: both are HTTP APIs sending pre-rendered templates.
The notification sender in the worker should sit behind a small interface so a provider
switch touches one file.
