# ADR 0049: Running out of credits, before and part-way

**Status:** accepted · **Date:** 2026-09-19 · **Decided by** the product owner · **Extends** ADR
[0027](0027-friction.md) (buying in place, R-57) and ADR [0033](0033-one-workspace-no-price-step.md)

## Context

The owner asked: _"What if a user hasn't bought credits and uploaded files — it won't be
processed, right? So we ask the user to buy credits (in a subtle way). Midway also sometimes the
tokens may get exhausted, so that also needs to be taken into consideration. Have you thought
about this? Is it already built? If not then do it."_

What was already built, and what was not:

| Moment | Server | Screen before this ADR |
| --- | --- | --- |
| Pressing the button with too few credits | Nothing is held; the job is cancelled | **Built**: a top-up is offered in place and the files stay (ADR 0027) |
| Part-way, the work needs more AI than its price covers | **Built**: the job pauses with a quote, nothing is charged, finished stages are checkpointed (locked decision 6) | **Missing**: the screen said "The job could not be completed", with no way to accept the quote |
| Accepting a quote the wallet cannot cover | Refused with 402 | **Missing**: the quote was lost and the customer started again |
| A chat message or commentary with too few credits | Nothing held, message not kept | A warning with a link away to the Wallet |
| An empty wallet before anything is pressed | — | Nothing said until the press |

A run cannot run out of *wallet* credits part-way: its whole price is held before it starts, so
the money is either there or the run does not begin. What can happen part-way is the AI cost
cap, and that is the case the screen did not handle. Customers never see tokens (locked
decision 5); what they see is credits and, here, a pause.

## Decisions

1. **A paused run offers to carry on.** When the run answers `needs_quote`, the screen returns to
   the button with the files still listed and says, plainly and without alarm, that the run
   paused rather than overspend, that nothing has been charged and nothing is lost, and what it
   would cost to carry on. **Accept and carry on** holds the quote and resumes from the stage it
   stopped at; stages already paid for are not run again.
2. **A quote the wallet cannot cover keeps its place.** The top-up is offered in place, and once
   the credits land the same quote is offered again, not a fresh start.
3. **The chat tops up in place.** A message or a commentary that is short shows the smallest
   pack that covers the shortfall (the server says how far short) beside the conversation, with
   the typed message still in the box. No trip to the Wallet page. The workspace already allowed
   the payment frame (R-57).
4. **An empty wallet is said early and gently.** On the upload screen, only when the wallet is
   exactly empty, one quiet line says so and that credits can be added right there when the
   button is pressed. It is a note, not a wall: files are added as usual. No price is shown in
   advance, because there is no price step (ADR 0033) and the price depends on the files.

"Subtle" is taken to mean: never block reading or uploading, never navigate away, never lose
the customer's files or message, and say what happens to their money in the same sentence.

## Tests

- `apps/web/e2e/mis.spec.ts` — a run whose first answer is a pause shows the carry-on panel with
  the quote, not a failure, keeps the file listed, and completes after acceptance; a funded
  wallet gets no nudge.
- `apps/web/e2e/ingest.spec.ts` — an empty wallet shows the note, files still upload, the press
  offers the top-up on the same screen with the file still listed, and nothing is held.
- Server behaviour (pause, quote, checkpointed resume, 402 on a short wallet) was already covered
  in `packages/ai` and `packages/jobs`.

## Known and left

After a run, if the wallet covers the run but not the dashboard update, the receipt says so and
points to the dashboard's own Refresh, which tops up in place like any paid button.
