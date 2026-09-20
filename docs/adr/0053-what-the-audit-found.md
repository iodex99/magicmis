# ADR 0053: What a full audit found, and what was fixed

**Status:** accepted · **Date:** 2026-09-20 · **Decided by** the product owner ("audit it
thoroughly and fix everything") · **Corrects** ADR [0052](0052-what-a-rupee-costs-to-earn.md)

## Context

The owner asked for a thorough audit of the whole system. Five independent passes were run over
money, security and tenancy, performance, the last ten commits, and reliability. This records
what they found, what was fixed, and what was deliberately left.

The first thing to say is that **ADR 0052 introduced a pricing defect**, caught here by two
passes independently. It is corrected below and the correction is the first item.

## Fixed

### Money

1. **Commentary was mispriced on two tiers out of three.** Migration 0048 folded commentary's
   49-credit instant surcharge into its base, on the stated ground that the customer would pay
   exactly what they paid before. `computePrice` is `round(base × tier_multiplier + surcharge)`,
   so the surcharge is deliberately not scaled by the tier. Folding it in put it through the
   multiplier: efficient fell from 168 to 158 credits and **expert rose from 422 to 495, up
   17.3%**, a price rise nobody decided, with each tier's AI cost cap moving with it. No base
   reproduces all three prices, so migration 0049 restores 149 + 49 exactly, and the pricing
   test now asserts every tier rather than the one that happened to be unchanged.
2. **The browser chose `delivery`, a direct pricing input.** This is what 0048 should have done
   instead. `POST /api/jobs` no longer accepts it; the server always runs instant. The price
   book keeps the surcharge mechanism so a queued mode can be priced again as data.
3. **Every export invoice threw on read.** Migration 0037 made the place-of-supply columns
   nullable and exports write null into both, but the row type still declared a non-null string,
   so `toRecord` handed null to a lookup that throws on anything but a GST state code. The
   Wallet page, the invoice PDF, the invoice email and the admin account page all went through
   it, so **one purchase from outside India permanently broke the Wallet for that customer**.
   Nothing covered it; there is now a test that issues an export invoice and reads it back.
4. **A missing currency was reported as free to collect.** The gateway fee fell back to zero for
   any currency absent from config, which is the exact shape of the bug 0052 existed to remove.
   It now refuses rather than defaults.
5. **Company restore fees were counted as memory-fee revenue.** The query lacked a `kind` filter.
6. **Credit lots had no FIFO tiebreaker.** A purchase grants its own lot and its bonus lot in one
   transaction with one timestamp, so the order was whatever Postgres returned, while the code
   comment claimed the purchase lot is spent first. Ordering is now `created_at, id`.

### Reliability

7. **Accepting a quote with a short wallet cancelled the run.** The shared 402 handler cancelled
   the job, which for a paused run captures the cancel-after-AI fee and terminates it: the
   customer was **charged for a job that delivered nothing** and lost every stage already paid
   for, and the second attempt met an illegal transition. Only a job that has not started is
   cancelled now. The top-up also asked for the whole quote rather than the gap; it now uses the
   shortfall the server already reports.
8. **The job sweeper could not expire the jobs it exists to expire.** `expired` was reachable
   only from `awaiting_review`, but the sweeper selects any abandoned non-terminal job with an
   AI call. It captured the fee and then threw, leaving the job running for ever and invisible
   to both sweepers. Under ADR 0032 a server run never waits for review, so this path had never
   once completed. `expired` is now a settle state from any running state.
9. **An unexpected error in a run stranded its hold and lied about the charge.** Anything that
   was not an unreadable layout or a quote was rethrown without settling, so credits stayed held
   for two hours while the screen said the run failed and nothing was charged. Pressing the
   button again took a second hold. It now settles as a platform fault, which releases the hold
   and charges nothing.
10. **A bare `catch` swallowed a legitimate quote pause** on the reference-layout stage, turning
    it into a generic error and discarding the checkpoint the customer had paid for.
11. **One bad row stopped whole maintenance sweeps.** The job sweeper, the memory-fee debit and
    the notification queue each aborted on the first failure. The first two now collect failures
    and report them at the end, as the purge loops already did. For notifications the
    consequence was worse: an invoice that could not be rendered was re-claimed every tick and
    **stopped all email for ever**, including security alerts. It is now treated as a send
    failure and follows the normal backoff.
12. **A failure after the chat had charged surfaced as a 500**, leaving the customer paid, the
    reply unshown and the board unreloaded. It now degrades to what the code comment already
    promised: paid for, still a proposal.
13. **A dropped integrity alert was logged as a successful run.** An email that says to treat the
    situation as a possible security incident now fails the task instead.

### Security and privacy

14. **Personal data reached the model in clear on the classification path.** The stage that runs
    when no trial balance was recognised passed `sheetKind: "other"`, which narrows the
    person-name heuristic to three literal headers, and passed no party columns at all. A column
    headed "Name", "Particulars", "Party", "Customer" or "Vendor" went out unredacted — while
    the privacy notice promises in terms that party and employee names are replaced with tokens
    before any part of a file is sent. Unrecognised sheets are now redacted as though they hold
    people, and a new `isPartyColumn` tokenises the headers a counterparty is written under.
15. **The per-company storage cap counted the size the browser declared.** Declaring one byte and
    then sending a full 4 MB chunk stored four million times more than it was charged for,
    without limit. A chunk must now fit inside the declared size.
16. **A file already received could be rewritten in place**, so one file could be priced and
    another processed. Chunks are refused once an upload is complete.
17. **The outbound sample cap was hardcoded**, so lowering it in config had no effect on the one
    server path that sends a sample. It is read from config.
18. **Four `@magicmis/ai` entry points lacked `server-only`.** They carry model ids and prices,
    which SPEC §2.5 says a customer must never see.

### Second pass

19. **A dead reservation was handed back as a live hold.** A prior reservation was returned as
    the idempotent answer whatever its status, so one that had expired or been released — that
    is, one under which nothing ever happened — made the caller try to capture a hold that was
    gone, which throws. The key is unique and the dead row kept it, so every later retry threw
    too: **a company whose memory-fee hold lapsed could never be charged again, for any month.**
    A dead row now gives up the key and a fresh hold is taken; captured rows still answer as
    duplicates, because there the effect really did happen.
20. **A crashed commentary batch paid Anthropic twice.** The batch was submitted and then each
    job’s `batch_id` written in its own statement. A crash part-way left jobs looking
    unsubmitted, so the next tick submitted a second batch for the same work while the first was
    orphaned and never collected. The ids are now written in one statement.
21. **Purging a company left its source files in the store for ever.** Shredding the key makes
    them unreadable, so this was storage rather than confidentiality, but a company purged down
    the archive path never sets `deleted_at`, which is the only thing the upload purge looks
    for now that nothing expires. The purge now removes them, as ADR 0047 said it did.
22. **Downloading your own file spent the AI rate limit.** A handful of downloads could throttle
    the customer’s chat. Downloads have their own bucket (migration 0050).
23. **Releasing a hold could replace the error that caused it.** A job already terminal made
    `failJob` throw a state error over the layout fault the caller had to answer with.
24. **A dashboard update refused for a short wallet left its job row stuck** in `estimated`
    under an idempotency key a retried run kept re-confirming. Nothing was held, so no money was
    at risk; the row is now cancelled so the key is free.

## Left, with reasons

- **The dashboard decrypts every stored snapshot one at a time** to read metrics it then
  discards, and snapshots carry every prior month, so the cost grows with the square of the
  months held. This is the largest remaining bottleneck and the right fix changes the snapshot
  format, so it is its own piece of work (R-72).
- **Gateway settlement reconciliation** (R-69), **unspent credits as a liability** (R-70) and
  **tax on AI spend** (R-71) are unchanged: one needs a live account, two need an accountant.
- **Connection pooling and function memory** are deployment decisions the owner makes with real
  traffic (R-73).
- **No refund or chargeback path exists.** Credits are sold as non-refundable, so this may be
  deliberate, but a refund in the gateway dashboard would silently diverge from our ledger
  (R-74).
- **`vitest` is below the version that patches a path-traversal advisory.** It is a test-runner
  dependency, the advisory needs control of test code, and CI audits at high severity, so the
  major upgrade is not being done inside an audit (R-75).
- **Customer accounts have one factor.** ADR 0028 removed 2FA at the owner's direction. That
  stands, but it is the largest residual risk in the data-protection review and R-50 should say
  so plainly.

## Tests

New coverage for each fixed defect that could carry one: every commentary tier price; an export
invoice issued, listed, loaded and rendered; a chunk larger than the declared size refused; a
completed upload refusing replacement; and the party-column headers. The full suite is green
uncached across all 24 packages.
