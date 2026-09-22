# ADR 0063: "Where to act" is on the board

**Status:** accepted · **Date:** 2026-09-23 · **Decided by** the product owner ("I want the
'Where to act' button on the dashboard so it is visible at all times"; "it shall be bold and
shall stand out, treat it like the moat") · **Adjusts** ADR [0062](0062-where-to-act.md)

## Context

ADR 0062 put the button in the assistant, beside "Write the commentary". That was the cheap
place to put it — the assistant already owned the paid-job flow, the month picker and the panel
the answer reads in — but it is the wrong place to find it. It is only visible once the chat is
open, and then only in the row of commentary controls.

A board member's first question is not *what happened*; it is *what do we do*. The button that
answers it should be in view whenever the board is.

## Decisions

### 1. The button is on the board, beside Present

`DashboardClient` renders it in the board header, and it is subject to the same two conditions
Present is: disabled while a layout change is pending, and disabled when no month is on the
board. Nothing to act on is nothing to advise about.

### 2. It carries the weight, and Present steps down

It is the last control in the header, the only filled one, and a size larger than its
neighbours, with a font step and the hover lift the rest of the product already uses. Present
moves from primary to secondary in the same change, because a header with two filled buttons
has no hierarchy at all — the emphasis is bought from Present, not added on top of it.

The weight is spent entirely inside the design system (ADR 0036): the one indigo accent, the
`lg` size, `font-semibold`, and `.lift`, which collapses under reduced motion with everything
else. No gradient, no glow, no second accent colour, and the icon is the hand-drawn `target`,
never a sparkle.

This is the one place on the board where the product asks a question back rather than answering
one, and it is what a board member came for. It should read that way at a glance.

### 3. It runs on the month the board is showing

Not on the assistant's own month picker. The board's period filter is the month the reader is
looking at, so that is the month they mean. Pressing it also moves the assistant's picker to
that month, so the two never disagree about which month the answer is for.

### 4. The assistant still owns the work

The board hands the request over rather than doing it — `onWhereToAct(period)` → Workspace →
`runAction` on the assistant, exactly the shape Investigate and Change already use. That keeps
one implementation of the paid-job flow: the quote over the AI cost cap, the short wallet, the
error, and where the answer is read. A second, thinner copy on the board would have been a
second place for the money handling to drift.

The chat is opened by the press, because that is where the answer appears and where anything
that stops it appears too.

### 5. A nonce makes a second press count

`runAction` carries one, and the effect that acts on it compares against the last it ran. The
effect's other dependencies change while the job is in flight — `busy`, and the list the answer
lands in — and the nonce is the only one that says whether this is a *new* request.

## What this does not do

- **It does not put the answer on the board.** The suggestions still read in the assistant,
  beside the commentary, and in History. The workspace is the board and the chat (ADR 0047), and
  this does not add a third thing to it.
- **It does not change what the button costs or what it checks.** Everything in ADR 0062 —
  the priced `board_actions` job, the shared facts pack, the placeholder check over every field
  — is untouched. This moves where it is pressed from.

## Tests

`apps/web/e2e/mis.spec.ts`: the button is visible and enabled on the board without opening
anything first, and — like Present — it is disabled when no file is ticked and the board has no
months to act on.
