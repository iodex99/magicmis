# ADR 0055: The owner's business page

**Status:** accepted · **Date:** 2026-09-21 · **Decided by** the product owner ("an admin page
where I get to see all the detailed analytics... it will only be for me and shall have a private
URL")

## Context

The owner asked for one page showing signups, companies, AI usage, MRR and ARR, in detail, for
their eyes only.

Most of the pieces were already collected. The admin console has a Margin page answering "is
each action profitable" (SPEC §26) and an Overview stub from Phase 2 showing four counts. What
was missing is everything above that line: who signed up, how many of them ever got value, what
came in, what recurs, and what the AI costs against it.

## Decisions

### 1. It lives in the admin console, not behind a secret URL

The console is already the owner-only surface, and it is protected by things a secret address is
not: it is a separate app on its own domain, sign-in needs a password **and** a TOTP code in one
step, the email must be on `ADMIN_ALLOWED_EMAILS` and is re-checked on every request, and
`ADMIN_IP_ALLOWLIST` can pin it to one address. Removing an email ends its live sessions at the
next request.

An unguessable path adds nothing to that. It is not a second factor; it leaks through browser
history, referrer headers, proxy logs and anyone who ever sees the screen; and it cannot be
revoked without moving the page. The page is at `/business` behind the existing gate, which is
what actually makes it the owner's alone. If the address itself should be non-obvious, that is a
one-line change to the route folder, but it should be understood as tidiness rather than
security.

### 2. Cash collected and revenue earned are reported separately

This is a prepaid product: a customer pays once and spends over months. Reporting the purchase
as revenue overstates every month somebody buys in, and understates every month they spend down
a balance. Both are shown, and the unspent balance is labelled as what it is, a liability for
work not yet done.

### 3. There is no MRR here, so the page does not claim one

Nothing is subscribed. Two different things are shown and never added into one figure:

- **Committed monthly** is active companies times the memory fee. It is charged every month a
  company stays active whether or not anybody runs anything, so it is genuinely contracted.
- **Consumption run rate** is the last thirty days of spend with memory fees removed, so the fee
  is not counted twice. It repeats in practice because the report is monthly, but nobody has
  promised it.

The annual figure is twelve times both and is labelled a run rate. Calling the total "MRR" would
overstate what is actually owed to us, which is the one number an owner must not flatter.

### 4. Activation is a completed setup, not a signup

The funnel is signed up, added a company, completed a setup, bought credits. A company row
costs nothing and means nothing; a completed setup is the first moment the product has done its
job. The page also gives the median days from signing up to that point.

## Consequences

- Every figure is live and computed on integers. No float touches a money figure, and the
  percentages and ratios are floored integer arithmetic for the same reason.
- The AI cost share is measured against revenue **earned**, not cash collected, because
  comparing a month's vendor bill to a month's purchases would swing with whoever happened to
  buy that month.
- `businessReport` is one function in `apps/admin/src/server/business.ts`, so the page stays
  presentation. Adding a metric is a query there, not a new page.

## Tests

`apps/admin/test/business.test.ts` covers the two things that could quietly mislead: a purchase
is counted as cash and **not** as revenue until it is spent, and the memory fee is excluded from
the consumption run rate so the contracted and uncontracted figures cannot double count. It also
checks that adding a company is not activation, and that AI cost is attributed to the window it
happened in. `apps/admin/e2e/admin.spec.ts` renders the page as a signed-in admin and asserts
that both revenue figures appear and that the recurring panel never says "MRR".
