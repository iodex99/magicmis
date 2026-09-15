# ADR 0027: Removing friction — a shorter sign-up, one-screen runs, and payment at the point of need

**Status:** accepted · **Date:** 2026-09-15 · **Follows** [0026](0026-ui-redesign.md)

## Context

The product owner asked for an app a newcomer can use without being taught: "remove
unnecessary steps which may add friction… design, flow, UI, everything".

Counted honestly, a new customer made **sixteen** moves between arriving and holding a
workbook, filled **eleven** fields before seeing a single screen, and faced **three**
decisions nobody can make on day one. [docs/plans/friction.md](../plans/friction.md) has
the full list.

Several of those steps are locked by the spec and are not friction for its own sake:
nothing is free (§2.3), prepaid credits only (§2.4), a fixed price confirmed before every
paid action (§12), 2FA on every account (§8). Those stay. Everything else was fair game.

## Decisions

### 1. Sign-up asks for four things, not eleven

Email, password, business name, one consent tick. **The billing address and GSTIN move to
the first purchase**, which is where GST place of supply (§13) is actually needed and where
the customer is already thinking about invoices.

- Migration `0034` makes `accounts.state_code` nullable; the shape check still applies
  whenever a state *is* set.
- `signupProfileSchema.billingAddress` becomes optional; `placeOfSupplyState` returns
  `string | null`.
- `accountTax` in `packages/billing` refuses with `BILLING_STATE_UNKNOWN` rather than
  defaulting to a state. A wrong place of supply is a wrong tax invoice, so it is never
  guessed.
- `walletView` reports `billingReady`; the Wallet asks for the address inline, with the
  business name **prefilled from sign-up** — nothing already given is asked for twice.

One checkbox now covers Terms and Privacy notice, each linked separately. Two consent rows
are still written with their own versions; the record is unchanged, the gesture is one.
Recorded as **R-56** for the legal pass.

### 2. The confirmation email signs you in

`/auth/callback` already establishes a session. It sent the reader to `/sign-in/verified`,
a page whose only content was "now go and sign in" — so they typed the password they had
chosen two minutes earlier. The link now lands on authenticator setup.

Two real bugs surfaced while doing this, both previously masked by that dead end:

- **The session cookie was being dropped.** `nextUrl.origin` normalises to `localhost`
  even when the request arrived on `127.0.0.1`, and the just-written auth cookie is scoped
  to the host in the request. The redirect went to the other spelling and the browser
  presented no cookie. The callback now redirects to the host the browser actually used.
  Nobody had noticed because the next step used to be a fresh password sign-in.
- **The confirmation email used `type=email`**, the OTP type for an email *change*. It is
  now `type=signup`.

The callback also decides its destination from what happened rather than from a hardcoded
`next`: with a session it continues to enrolment, without one it falls back to
`/sign-in/verified`.

### 3. The run is one screen

The price is knowable the moment the files are read, so it is simply shown. **"Get price"
is gone, and so is the separate confirmation page.** A panel beside the files carries
everything §12 requires — action, tier, delivery, exact credits, available now, available
after — and one button: **Run setup — 999 credits**. That click is the confirmation;
nothing is held or charged before it.

Tier and delivery collapse into **Options**, closed, with defaults chosen and each
explained in a sentence. Re-pricing is keyed on a signature of the priceable inputs, so
changing a dropdown twice does not leave a trail of draft jobs.

When the balance is short, the panel says by how much and links to the Wallet with
`?need=<credits>`, which banners the shortfall and marks the smallest pack that covers it.
Every pack now says what it buys — "About 8 monthly refreshes".

Paid actions without files (dashboard, commentary) carry the price on the button itself
(`Add the dashboard — 299 credits`) by reading the public price book on mount. The
confirmation dialog stays.

### 4. The mapping review leads with the answer

"38 of 42 mapped from your own rules and the library · 4 need a look". The grid opens
filtered to the rows that want a decision; when none do, the table is collapsed behind
"Review all 42" and the primary action is **Looks right — continue**.

### 5. A new account is told what to do

A three-step "Getting started" card on `/app` — add a company, put credits in the wallet,
run the first MIS — ticking off as each completes and removing itself once the account has
produced a workbook.

## Verified facts (2026-09-15)

| Fact | Source |
|---|---|
| `verifyOtp({ type: "signup" })` is the type for a sign-up confirmation and establishes a session; `email` is for an email-change confirmation. | https://supabase.com/docs/reference/javascript/auth-verifyotp |
| Cookies are scoped by host, and `localhost` and `127.0.0.1` are distinct hosts that do not share them. | RFC 6265 §5.1.3, §7.1 |

## Consequences

- **Measured:** the sign-up-to-app E2E dropped from 31.2 s to ~20 s, and the setup run
  lost two full page transitions.
- **Tests moved where the flow moved**, and only there: `helpers.ts` (four fewer fields,
  no second sign-in), `mis.spec.ts` (no "Get price"; the run button is the confirmation),
  `wallet.spec.ts` (billing details are entered at the Wallet, which is the new journey),
  `ingest.spec.ts` (empty-state copy). A new `billing.test.ts` case proves a quote is
  refused until the place of supply is known and succeeds on a GSTIN alone.
- **SPEC §12 is unchanged in substance:** the confirmation is still explicit, still shows
  the balance before and after, and still precedes any hold. It is now a panel rather than
  a page.
- **Still true:** nothing free, prepaid only, 2FA mandatory, one session per account, and
  no recognition result shown before a charge.
- **Two pre-existing flakes were fixed on the way**, neither caused by this work but both
  able to fail CI on a coin flip:
  - `packages/redact`'s 100,000-token collision test timed out under a loaded
    `pnpm -r test`. The tokens are deterministic for a fixed key, so a real collision
    would fail every run; the timeout was raised and the reasoning written into the test.
  - The admin break-glass and recovery tests fabricated a TOTP timeline from a timestamp
    captured when the file was **loaded**. Under a loaded run the file starts minutes
    later, every fabricated timestamp falls behind the real clock, and the single-use
    "fresh code" check refuses a code the test believes is current. Both now anchor the
    timeline to the clock at the moment of the call.
- **Left for later (R-57):** taking the payment inside the run screen instead of linking to
  the Wallet. It needs billing details and Razorpay checkout in a flow that currently holds
  a browser-side pipeline, and the two-click version is honest and safe.
