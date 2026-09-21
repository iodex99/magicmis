# ADR 0057: What the end-to-end audit found

**Status:** accepted · **Date:** 2026-09-21 · **Decided by** the product owner ("test every
flow once again thoroughly with utmost care — the sign up login, token buying, wallet
behaviour, payment, currency conversion token behaviour, chat behaviour invoice EVERYTHING
end to end; look for bottlenecks, issues and fix everything") · **Follows** ADR
[0053](0053-what-the-audit-found.md) and ADR [0054](0054-decisions-on-the-open-items.md)

## Context

Six audits ran in parallel over sign-up and sessions, the wallet and payment, invoices and
currency, the credit ledger and pricing, chat and the dashboard, and the run and file
lifecycle. Each traced its flow through the code rather than through the tests.

Two of them arrived independently at the same critical defect, which is the strongest
evidence this exercise produced.

## The defects, and what was done

### 1. Money taken, credits rolled back (two ways in)

`issueInvoice` took the place of supply from the **purchase** and the buyer's country from
the **account row, live**. A customer correcting their address between paying and the
webhook landing made the two disagree, and `invoices_place_of_supply_is_india_only` refused
the insert — **inside the transaction that grants the credits**. The grant rolled back, the
payment stayed captured at Razorpay, every webhook retry failed identically, the reconciler
swallowed it into a counter, and nothing appeared on any operator screen. For a bank
transfer the window is days.

The mirror case did not crash: a dollar purchase whose owner later set their country to
India issued a **zero-rated export invoice naming India**, which is a false statutory
document on an append-only table with no credit-note path.

The same crash was reachable a second way. `isValidGstin` checks the shape, the embedded
PAN and the base-36 check character; it has never checked that the leading two digits name
an **assigned** GST state. 28 was split away in 2014 and is assigned to nothing, and exactly
one completion of any fourteen characters is checksum-valid, so one is trivially built. That
code became the account's state, then the purchase's place of supply, and finally reached
`stateName`, which throws.

**Decision: the invoice is built from the sale.** Migration 0054 snapshots `buyer_country`
and `buyer_gstin` onto `purchases`, with `(currency = 'INR') = (buyer_country = 'IN')` and
"an export carries no GSTIN" as check constraints, so the invoice's own constraint is
unreachable. The GSTIN's state is validated where the GSTIN is accepted, and `accountTax`
declines to use one that names no state.

### 2. A refunded purchase could still be credited

Razorpay documents that events may arrive out of order. The only status guard on the credit
path was `=== "credited"`, so a capture retry landing after a refund credited the wallet and
**overwrote the refund record**. The customer ended with the money back and the credits.
Refused now, and audited as `billing.capture_after_refund`.

### 3. A password-reset token was an account takeover

`/auth/callback` accepted `recovery` among its OTP types, verified it, and **claimed the
session**. So a reset link — the attacker's own — sent to a victim signed the victim into the
attacker's account, with no password ever set and no interstitial; anything they then
uploaded landed in the attacker's tenancy. A victim's own link, seen once in a forwarded or
shared mailbox, became a session without the password change that would have alerted them.

`confirmation.html` is the only template pointing at this route and it sends `signup`.
Nothing issues `invite`, `magiclink`, `email_change` or `email` — there is no invitation, no
magic link, and no way to change an email address in the product. **The callback now accepts
`signup` and nothing else.**

### 4. The session cookies were readable by any script

`@supabase/ssr` defaults to `httpOnly: false` with no `Secure`, which is right for an app
whose browser talks to Supabase. Nothing here does — there is no browser client anywhere in
the tree. So the access and refresh tokens sat in `document.cookie` for any script that ever
ran on the origin, and `authenticated` can read the tenant's rows straight from PostgREST,
which makes a stolen refresh token more than a session. Both writers now pass
`authCookieOptions`.

### 5. Data left for Anthropic without passing the redactor

A DuckDB error quotes the value that failed the query — `Could not convert string 'Rent —
Sharma, PAN ABCDE1234F' to INT64` — and that reason is replayed to the model in the next
round's tool result. `runChatQuery` redacted cells and not the reason, and
`assertNoRawIdentifiers`, the backstop, ran **only inside the `ok` branch**. Both closed.

The `dashboard_layout` stage added in ADR 0056 was sending raw payroll designation text for
the same reason — a designation column holds whatever the export put there. It now sends
**how many** values a split takes, never what they are, which is all the choice needs.

### 6. The same file twice doubled every figure, silently

`uploadIds` had no uniqueness constraint and the ownership check counted **distinct** ids, so
`["X","X"]` passed it. Two rows per ledger and period fan the engine's grid join out, and
every figure in the MIS doubled — with V1, V3 and V4 all still green, because both sides of
each check doubled together. Refused at the schema, and a reference MIS may no longer also be
a source file.

### 7. Free AI, and credits held for a job nothing could run

`fail()` in the run defaulted to `platform_fault`, which releases the whole hold and captures
nothing, and **every call site used the default** — so the `data_fault` branch was dead code.
Files that are readable but hold no balances reach that path *after* a real classification
call. Buy the minimum credits, upload unrecognisable files, repeat: our AI, free, on one
balance. It now settles at the `data_diagnostic` price, which is what SPEC §23 always said.

Separately, `createJob` silently upgrades a refresh to `refresh_with_restructure` when the
files drift, prices it at 599 rather than 299, and `confirm` holds that — but
`refresh_with_restructure` was not in the run route's allowlist, so the job 409'd and the
credits sat held for two hours. Pressing the button again held another lot. Added to the
allowlist; any refusal from that route now cancels rather than stranding the hold; and
`data_diagnostic`, which is a settlement price and not an action, is out of the create enum.

### 8. A cancel could take the workbook for free

`completeJob` writes the snapshot, the blueprint and the workbook, none of it in one
transaction with the capture. A cancel landing in that window released the hold, `capture()`
answered **0 without complaint**, and the job settled as cancelled with the workbook stored
and downloadable — while the charges list filtered exactly that row out.

Three changes: `capture()` takes a `required` flag and throws when a delivery's hold has gone
and captured nothing; a customer cannot cancel a job that is `rendering` (the worker's sweep
still expires an abandoned one, with the cancel-after-AI fee, which is a different thing);
and `/api/outputs/:id` joins `jobs` and refuses an output whose job is not `completed`, as
`commentaryForJob` has always done. The download also gets the rate limit the raw-file
download has.

### 9. The price book published prices the button does not charge

ADR 0050 removed the Delivery option, so the server always picks `instant` — but `priceList`
computed the **standard** prices. Commentary is the one action with a surcharge: the page
read 373 at Expert and the button charged 422. A page that exists so a button's price is on
record now shows the price the button charges.

### 10. Settlement prices moved after the sale

`jobs.price_credits` is frozen at creation, but the delivered-tier downgrade, the data-fault
price and the cancel-after-AI fee were all read `at: now`. An admin publishing a new version
mid-job repriced a settlement the customer never agreed to. All three now read as at
`job.created_at`.

### 11. Chat could answer twice, and could be bricked

`processMessage` read `state` and then wrote `'running'` with no compare-and-swap, so a
retried slow message ran the model twice and put two replies in the thread for one charge.
It is a claim now. `history()` joined an answer's paragraphs with no cap while the stage
schema allows 6,000 characters, so one verbose answer made every later message in that thread
500 with its hold stranded — capped. `sendMessage` returned the thread it had just opened
rather than the one the message is actually in, so an idempotent retry showed the customer an
empty conversation for a message they had paid for — the row decides now, and only a new
message counts against the thread cap. And `finish()` wrote the reply before capturing, so an
expired hold left a readable answer nobody was charged for — the charge goes first.

### 12. A hidden month was not hidden in a commentary re-read

`dashboardPayload` filters through `visibleValues`; `commentaryPayload`, twenty lines below
in the same file, did not. A commentary about a month the customer has taken off the
dashboard is not worth showing, so it is not shown.

### 13. Abandoned uploads filled the storage cap for ever

`companyStorage` counts every row that is not deleted, including `status = 'uploading'` rows
holding no bytes, using the size the **browser declared**. `companyFiles` does not list them
and nothing reaps them, because files no longer expire. Twenty-one `createUpload` calls with
no chunks — or a few dropped connections — filled a company's cap with files that could never
be seen or deleted. An upload in flight now always carries an expiry
(`sources.incomplete_upload_hours`, migration 0055), replaced by the retention rule the moment
it completes.

### 14. Schema hardening (migration 0055)

`source_upload_reads` is the evidence behind "every opening is on a record you can see". It
had the append-only trigger but not the `truncate` revoke every other append-only table has,
and TRUNCATE does not fire row triggers. Added. And migration 0052's ordering trigger only
looked downwards, so an update pushing an older row's date forward past a later version
passed; it is symmetric now.

## Bottlenecks

`openForCompany` is a transaction, a **`for update` lock on the company's key row** and a KMS
unwrap, every single call. Reading a forty-message chat thread did all three a hundred and
twenty times — on the page the workspace opens on — serialising against any run touching the
same company. `loadUploadBytes` did it once per four-megabyte chunk, twenty-five times for a
file at the limit.

`openManyForCompany` opens many sealed values under one unwrap, the rule `latestMetricStores`
already followed for snapshots. The chat thread, the model's history and the query steps each
take one; a file's chunks are taken in groups of eight, which bounds the extra memory rather
than holding every sealed chunk beside every plain one.

## What this does not do

- **`chat_edit` can still add a breakdown on a split the company's books do not make.** The
  `dashboard_layout` stage is refused that (ADR 0056) because nobody asked for the box; here
  the customer asked for it by name, the box says "Nothing to split this month", and it starts
  working if they later upload payroll with that column. Telling them up front needs the stage
  to be given the company's splits, which is a prompt version and therefore an eval (R-28).
- **No credit note exists**, so an invoice issued with wrong particulars still has no lawful
  correction path. Recorded as R-78.
- **`accountingCsv("credits_sold")` still drops a refunded purchase** while its tax invoice
  stays in the GST summary, so three reports that should reconcile do not. R-79.
- **A refund event marks the whole purchase refunded** whatever the refund amount. R-80.
- **The LUT ARN is not checked against the invoice's financial year.** R-81.
- **The per-IP auth throttle checks and increments separately**, so a burst of parallel
  attempts all read zero and pass. R-82.

## Tests

`packages/billing/test/billing.test.ts`: a purchase whose owner changes country mid-flight is
credited and invoiced as the sale was; a refunded purchase is not credited by a late capture
and its refund is not overwritten. `packages/accounts/test/accounts.test.ts`: a checksum-valid
GSTIN naming an unassigned state is refused at the boundary.
`packages/engine/test/open-many.test.ts`: twenty values under **one** unwrap, order and nulls
preserved, no unwrap at all for a page of nulls, and a value sealed for another purpose,
another id or another account still refused. `packages/wallet/test/pricing.test.ts` now asserts
the published price is the charged price, at all three tiers.
