# 0078 — The site before the product

- **Status:** accepted
- **Date:** 2026-09-30
- **Decided by:** the product owner — "shall i buy the domain and keep now? and maybe we can
  deploy it but non usable and say something like coming soon to atleast increase the domain
  authority"
- **Relates to:** R-01 (the domain), R-26 and R-59 (payments, which wait on a GST number).

## Context

The product cannot take money until a GST number arrives: Razorpay needs it, and so does the
export LUT. The domain can be bought now, and the owner wants it working for search meanwhile.

A "coming soon" page does little for that. Search engines rank pages for what is on them and how
they are linked, and a domain gains nothing just by being registered. What helps is for the
product's real pages to be indexed early and to age. There are about twenty of them: the home
page, pricing, security, the guides, and the pages on MIS, management accounts and dashboards.

## Decision

**Deploy the whole public site, with the product closed.** `PRELAUNCH=1` does three things:

- sign-up, sign-in and the finish step render "Opening soon" (`OpeningSoon`) instead of a form;
- every route that could create, claim or recover a session answers `503 opening_soon`: sign-up,
  sign-in, finish, forgot and reset;
- the email link and the provider start both redirect to that page.

Every public page is untouched. The switch is an environment variable, validated at boot as
`"0"` or `"1"` and nothing vaguer, and it defaults to open. Development, CI and a launched
production never see it; only the pre-launch deploy sets it.

**No email capture.** A waiting-list form would hold personal data for a purpose the privacy
notice, now final (ADR 0074), does not name. The page links to how it works, pricing and
security instead.

**Placeholders are safe while it is on.** The server refuses to start without its secrets, but
nothing reachable before launch uses them: no account can exist, so nothing is encrypted,
charged, emailed or sent to a model. Only Supabase has to be real, because the public pages read
the prices, the welcome offer and the legal facts from its database. The
[runbook](../runbooks/pre-launch.md) gives the exact values and the order of the launch.

## Consequences

- Launch is five steps, all in the runbook: the real secrets, `auth-email --apply`, `go-live`,
  the worker, then `PRELAUNCH=0`. The indexed pages do not change.
- `apps/web/src/lib/prelaunch.test.ts` reads every auth route and fails if one is ever written
  without the check. A new door into an account is the likely way this stops being true.

## Sources

- `supabase db push` pushes `supabase/migrations` to a linked project:
  <https://supabase.com/docs/reference/cli/supabase-db-push> (2026-09-30).
