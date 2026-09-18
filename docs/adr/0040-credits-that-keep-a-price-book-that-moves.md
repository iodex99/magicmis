# ADR 0040: Credits that keep, a price book that moves, and a chat that says what it costs

**Status:** accepted · **Date:** 2026-09-18 · **Decided by** the product owner · **Amends**
locked decisions 3 and 5 as recorded in CLAUDE.md, and SPEC §11.5, §28 and §32 · **Supersedes
in part** ADR [0014](0014-credit-wallet-design.md)

## Context

Four things the owner asked for, in their words: the public pricing page should go ("why do we
have to show the pricing even"); the explainer video had no home anyone could find; the chat
panel needed a name, a visible tier choice and a one-liner per tier "and about token usage";
and the wallet should let people add credits, should not expire them after a year ("people
won't buy only then"), and should stop telling customers we are holding their money —
"we can simply not do the recurring work if there are no credits available and once they are
added, it can resume".

Two of these met locked decisions, so both were put back to the owner rather than worked
around (rule 3).

## Decisions

### 1. The public price book goes; the pack prices stay

The owner chose to remove the public pricing page outright. That is not possible in full:
Razorpay requires the price of what a merchant sells to be visible, in INR, before it will
activate an account, and R-26/R-60 are still open. So the split is by what is actually sold:

- **Credit packs are sold for money** and keep a public page at `/pricing`, priced in INR with
  the GST note and in USD for everywhere else.
- **The per-action price book is consumption, not a purchase.** It moved to `/wallet`, where it
  is still free to read (locked decision 3 is about charging, not publicity) and is beside the
  balance it is spent from — which is where someone actually asks the question.

The premise the owner raised — that not every task uses the same number of credits — is the
opposite of the design, and is worth restating because it is the product's promise: a refresh
costs the same whether the model sailed through it or laboured, because locked decision 6 makes
us absorb the variance. That promise is now made in prose on the pricing page rather than
implied by a table of numbers.

### 2. Credits never expire

`wallet.lot_validity_months` (12) and `wallet.lot_expiry_notice_days` are deleted, along with
the nightly `expireLotsSweep`, the `queueLotExpiryNotices` job and its email. A prepaid balance
that wastes is a reason not to buy the larger pack, which is the opposite of what prepaid
credits are for.

`credit_lots.expires_at` is made **nullable and set to null everywhere** rather than dropped,
and `'expire'` stays in the `credit_ledger` entry-type constraint and in `applyEntry`. The
ledger is append-only and hash-chained: historical `expire` rows must still replay, or the
nightly integrity check reports a wallet mismatch for every account that ever had one. The
accounting export's `credits_expired` report and the margin report's breakage line keep working
on that history; they will simply stop growing.

FIFO consumption was "earliest expiry, then created_at". It is now **oldest first by
`created_at`** — which is what the wallet screen and the terms already promised — and
`credit_lots_fifo_idx` is rebuilt on `(account_id, created_at)`.

`shrinkHoldsTo` and `addCalendarMonthsUtc` are removed: both existed only so that an expiring
lot could uncover a hold. With nothing expiring, a hold can no longer shrink under a running
job.

### 3. Holds are described from the customer's side

The mechanism is unchanged — credits backing a running action still cannot be spent twice — but
"held" told the customer about our bookkeeping. The wallet now reads **Running now**, and the
ledger tells a story: `Action started` → `Charged`, or `Action started` → `Returned, unused`.

The recurring work already behaves as the owner asked: the monthly memory fee is a direct
capture with no reservation, and a company whose fee cannot be charged moves to a state that
blocks new work, keeps everything readable, and returns to active when the fee is paid. What
was wrong was the name — "Grace period" reads as a penalty clock. It is now **Paused — add
credits**.

### 4. The chat says what it is and what it costs

The panel is **Chat with the MIS**, subtitled with the company name and the promise that every
number is computed rather than written. The tier chooser was an 11-pixel select labelled
"Depth"; it is now three buttons carrying the tier name, its one-line description, and **the
credits that message will cost at that tier for what is currently being asked** — read from the
versioned price book on the server and passed in.

The owner asked for "token usage". Tokens are not shown, and this is the one place the ADR
declines a request outright: locked decision 5 says users never see tokens, model names or AI
cost, and the whole pricing model depends on that boundary. Credits are the only unit the
customer transacts in, so credits are what the chooser shows.

### 5. The explainer video has a home

`docs/brand/explainer/index.html` rendered to a recording that lived in a session scratchpad and
was lost. It is now `apps/web/public/brand/tour.webm` with a poster frame, played on
`/how-it-works` and linked from the home hero, with `VideoObject` structured data. It is silent
and says so; its figures are the fictional company's (SPEC §2.3).

## Consequences

- **A migration deletes two config keys.** Anything added later that reads
  `wallet.lot_validity_months` will throw at boot rather than default quietly.
- **`walletSummary` lost its `now` parameter** and `GrantInput`/`GrantResult` lost `expiresAt` —
  a public API change in `@magicmis/wallet`.
- **The pricing page is now a Razorpay compliance surface**, not just marketing. Removing the
  pack table would put account activation at risk; the page says so in a comment.
- SPEC §11.5 (expire lots), §28's grace naming and §32's "public price book" no longer describe
  the build. Following the precedent of ADR 0032, SPEC.md is left as the original record and
  CLAUDE.md carries the amendment.
