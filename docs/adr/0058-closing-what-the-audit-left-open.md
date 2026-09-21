# ADR 0058: Closing what the audit left open

**Status:** accepted · **Date:** 2026-09-21 · **Decided by** the product owner ("fix the things
you have flagged with your best decisions") · **Closes** R-78 to R-83, raised by ADR
[0057](0057-what-the-end-to-end-audit-found.md)

## Context

The end-to-end audit fixed what it could and listed six things it could not, because each needed
a decision rather than a patch. This is those decisions.

## 1. The throttle counts the attempt, not the failure (R-82)

`checkThrottle` read outside any transaction and `registerFailure` took the row lock only
afterwards. Two hundred sign-ins fired together all read `attempts = 0`, all passed, and the key
locked after two hundred guesses against a limit of ten. Customers have no second factor
(ADR 0028), so this throttle is the entire defence between a leaked password list and an account.

**`claimAttempt` counts and decides in one locked decision**, before the attempt is made. Keys
are taken in sorted order so two requests holding two keys cannot deadlock, and a locked key
refuses the attempt without the other keys recording it.

Counting *before* means a success counts too, and that would have been worse than the bug: an
office behind one address would lock its own network out by signing in ten times in a quarter of
an hour. So **`releaseAttempt` gives the attempt back** on success. The person's own key is
cleared outright — they got in, their earlier mistakes are spent — while the network's key only
gets the one attempt back. Clearing that outright is what let anyone holding a single valid
account zero the bucket for every other account behind the same address.

## 2. A refund is a second fact, not the absence of the first (R-79, R-80)

Any `refund.*` event set `status = 'refunded'` whatever the amount. Three consequences:
`accountingCsv("credits_sold")` filters on `status = 'credited'`, so a purchase refunded in July
vanished from the May it was sold in while its tax invoice stayed in May's GST summary; the
business page lost cash that had genuinely been received; and a ₹100 refund on a ₹50,000 purchase
read as a full one, because `razorpayWebhookSchema` never parsed the refund's own entity.

**The sale keeps its status.** `purchases` gains `refunded_minor`, `refunded_at` and `refund_ids`
(migration 0056), and partial refunds accumulate. Credits are still never reversed (ADR 0054) —
this changes what is written down, not what is done.

**Refunds are de-duplicated by the refund's own id**, not by the event. One refund arrives as
`refund.created`, `refund.processed` and `refund.speed_changed`, each its own event with its own
id, so the webhook de-duplication does not catch them. The test that found this was written
expecting event-level de-duplication and failed; the test was wrong and the code was worse.

## 3. A credit note exists (R-78)

`invoices` is append-only by trigger, and migration 0007's own comment said a correction is a
credit note — there was no such document, series or code path, so an invoice issued with wrong
particulars could not be corrected at all, and a refund reduced no output tax anywhere.

**`issueCreditNote` is a real document** with its own series (`CRN`), drawn from the same gapless
per-financial-year counter, naming the invoice it corrects (`corrects_invoice_id`). Every
particular except the amounts is copied from that invoice, which is what Rule 53 asks for and is
safer than rebuilding them from config that may have moved since.

The amounts are the reduction as positive figures. The total is exactly the money returned, and
the taxable value and the tax are split in the same proportion the sale had, so a partial refund
credits proportionate tax. A purchase may be refunded more than once, so the unique constraint
over `(purchase_id, type)` now excludes credit notes.

`gst_summary` reports credit notes as their own rows beside invoices, which is how GSTR-1 wants
them (Table 9B) — leaving them out overstated the output tax by whatever was refunded. It also
groups by rate now, so two rates in one month cannot collapse into a line nobody can tie back.

**TODO(review): R-10/R-12** — the wording, and the time limit §34 CGST Act sets on issuing one,
go to the CA with the rest of the legal review. The mechanism is built; the legal particulars are
not ours to settle.

## 4. The LUT is read by financial year (R-81)

Form GST RFD-11 is filed once per financial year, and `billing.export.lut_arn` kept returning
last year's ARN into the new one. An export invoice dated 5 April carrying the previous year's
ARN is not covered by a valid LUT, which makes IGST payable on a supply invoiced as zero-rated.

`billing.export` gains an optional `lut_by_fy` map from financial-year label to ARN, preferred
over the flat `lut_arn`. When placeholders are no longer allowed, a sale into a year with no ARN
recorded is **refused before the money moves**, and `issueInvoice` refuses it again.

## 5. The chat cannot add a box the books cannot fill (R-83)

`chat_edit` was checked against the metric catalog, not against what this company holds, so "add
payroll by department" for a company with no department split was charged, applied, and rendered
"Nothing to split this month" for ever.

`chatEditInput` gains an optional `splits` — the dimensions this company's books actually make —
and the check refuses a box that breaks a figure down by anything else. Judged, like the metric
check beside it, **only on what the change brings in**: a board that already carries such a box
keeps it rather than blocking every later change.

Prompt `chat_edit/v3` tells the model which splits exist and to offer the ones that do rather
than propose one that does not, so the refusal is the backstop and not the usual path. No prompt
version is active until its evals run (R-28), which is where v3 will be judged.

## What this does not do

- **Nothing reverses a credit.** A credit note records that money went back; the credits stay,
  because taking them back could drive a balance negative and spent credits cannot be recovered
  (ADR 0054). The two are deliberately not linked.
- **A credit note is issued only from a gateway refund.** There is no operator screen to raise
  one for a billing correction. When R-10/R-12 settle what a correction may say, that screen is
  the next piece.
- **The `splits` check only bites when the caller supplies them.** The field is optional so a
  caller that cannot cheaply know the company's splits is not blocked.

## Tests

`packages/accounts/test/throttle.test.ts`: two hundred claims fired together let exactly the
limit through; a locked key counts nothing further; a locked key in a pair refuses without
counting the other; success clears the person's key and returns one attempt to the network's;
a fresh window starts after the old one passes.
`packages/billing/test/billing.test.ts`: a full refund keeps the sale credited, records the
amount and issues a credit note naming the invoice it corrects; a partial refund is recorded as
partial, credits proportionate tax, totals exactly the refund, and the same refund arriving
again credits nothing further.
