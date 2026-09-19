# ADR 0050: A Wallet that sells, and a run with nothing to choose but its tier

**Status:** accepted · **Date:** 2026-09-19 · **Decided by** the product owner · **Amends** ADR
[0040](0040-credits-that-keep-a-price-book-that-moves.md) (where the price book lives) and ADR
[0027](0027-friction.md) (billing details at the first purchase)

## Context

The owner, on the Wallet: _"There is no CTA. Where is the user supposed to buy the credits from?
No payment gateway, no Razorpay integration, I don't see anything. Also the wallet page has per
action cost, which we discussed to remove earlier. This is the main page, the revenue generation
page."_ And on the run screen: the **Delivery** option (_"Instant runs now. Standard queues it and
emails you when it is ready, for fewer credits."_) _"can be removed fully"_.

The payment integration was built and working: order creation, the payment window, signature
verification and the webhook. What the owner saw was a page that hid it. A new account has not
yet said where to invoice it, and the Wallet answered that with a full address form and **no
packs, no prices and no button** until the form was saved. Under the form sat a table of what
each action costs. The page that earns the revenue opened on paperwork and a price list of
spending.

## Decisions

1. **The Wallet leads with buying.** "Add credits" is the first section: every pack as a card with
   its name, price, credits, bonus and what it covers, and one button. It is above the fold and is
   never behind a form.
2. **Packs are shown before billing details exist.** Tax and the total depend on the billing
   country; what is for sale does not. Until the account has billing details the cards carry the
   list price marked "before tax", in the visitor's currency by the same rule as the public
   pricing page (`visitorCurrency`: rupees for a visitor in India, dollars otherwise). Prices are
   still set per currency and never converted. The list comes from `listedPacks` in
   `apps/web/src/lib/server/packs.ts`, and `walletView` now requires the currency to list in.
3. **Billing details are a step inside the first purchase.** Pressing Buy on a new account asks
   where to invoice, once, naming the pack that is waiting. Saving carries straight on to the
   payment window for that pack with no second press. The form opens on the visitor's own country
   rather than always India, and the GSTIN field is shown only for India. "Add invoice details
   now" remains for a customer who wants totals before choosing. Sign-up still asks four things.
4. **Once billing details exist, a card pays in one press.** It shows the total, the tax line
   (CGST and SGST, IGST, or "No tax added" for an export) and a button that says `Pay` and the
   amount. Bank transfer stays as a quiet link on eligible packs.
5. **Payment methods are described for the customer in front of us.** UPI and netbanking are
   named only to a customer billed in rupees.
6. **The per-action price table leaves the Wallet but is not deleted.** It moves to
   `/wallet/prices`, reached by one quiet link under the packs, "What actions cost". The owner
   asked for it off the revenue page and it is. It was not removed from the product because there
   is no price step (ADR 0033): a button holds credits when pressed, so the standard price of
   each action must be on record somewhere the customer can open, free (locked decision 3). The
   terms' "price book" link now goes there; it pointed at the public pack page, which has not
   listed action prices since ADR 0040.
7. **What a pack covers comes from the live price book.** The hard-coded "covers about N
   refreshes" figures in the Wallet are gone; `packWorth` computes the line from current prices,
   as the public page does (working rule 5).
8. **The Delivery option is removed from the run screen.** Every run is instant. The only option
   left when adding a file is the intelligence tier. The server still understands `standard`
   delivery and the price book still carries its multiplier, so nothing in pricing, the API or
   stored jobs changes and it can return as data. This is margin-neutral or better: the removed
   choice was the cheaper one.

## Consequences

- A new customer can go from an empty Wallet to a payment window in two presses and one short
  form.
- The Wallet response gains `listed` (packs before tax, or null once billing details exist) and
  a `worth` line on every pack.
- The price table is one click further from a customer who wants it. If support hears "what does
  X cost", the link's prominence is the thing to revisit, not the Wallet's layout.
- A live payment still needs the owner's gateway account (R-26) and, for dollars, international
  activation (R-60). Locally and in CI the payment window is stood in for at the network edge.

## Tests

`apps/web/e2e/wallet.spec.ts`: the Wallet opens on six packs with enabled Buy buttons above the
fold, no form and no price table, and the table is one link away; Buy asks where to invoice once
(country defaulting abroad, no GSTIN), then opens payment for the chosen pack with the order our
server issued, after which cards read `Pay` and the total; an Indian account sees CGST and SGST
before paying and can take a proforma by bank transfer.
