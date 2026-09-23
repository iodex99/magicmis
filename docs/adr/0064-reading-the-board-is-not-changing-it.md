# ADR 0064: Reading the board is not changing it

**Status:** accepted · **Date:** 2026-09-23 · **Decided by** the product owner, who asked how
the month filter works and then for "a tickbox kind of thing for months … or a whole year
filter, or comparison between months or month to year" · **Builds on** ADR
[0045](0045-a-companys-own-layout-is-remembered-for-good.md), ADR
[0046](0046-a-dashboard-built-by-chatting-and-presented-live.md), ADR
[0056](0056-a-dashboard-chosen-for-the-company.md)

## Context

The month picker is an **anchor**, not a filter. Every box carries its own window and resolves
it against that anchor (`periodsFor`): `current` is the anchor month, `fy_to_date` runs from the
company's financial-year start to it, `last_n` is the N months ending at it. Moving the picker
slides every window at once.

That much was already right. What was missing is that **the windows themselves were reachable
only through the chat.** "Show the last twelve months", "compare to last year" and "year to
date" have all worked since ADR 0046 — they set `periods` and `compare` on a box, the same
fields `dashboard_layout` picks from — but each one costs a message, and a reader looking at the
board has no way to know they exist. A board member who wants to see the year is not asking to
change the dashboard. They are asking to read it differently.

## Decisions

### 1. A lens, not an edit

Two controls beside the month picker — **Range** and **Compare** — retarget the whole board at
once. They are a `BoardLens` applied at render (`buildWidgetView`), over metric values the
engine has already computed:

- **no AI call and no charge**, because nothing new is computed and no model is asked anything;
- **nothing is written**, so the board a company saved is the board it opens on next time. Both
  controls start at "As saved" and a reload returns there.

This is the whole reason it can be free. A change to the dashboard is a change to a company's
own layout, kept for good and versioned (ADR 0045). A lens is a way of looking at one.

### 2. A box that states one month keeps stating one month

The rule that makes a single global control safe: the range reaches only boxes whose own window
is multi-month. A `kpi_card`, a `waterfall` and a `comparison` state one month by construction,
and **revenue for five months is not a figure anyone asked for.**

This is what rules out the tickbox version of the request. Ticking Jan, Mar and Jul forces a
question with no good answer — does the revenue card then sum them, average them, show the
latest, or show three? — and it has to be answered again for the waterfall and for every table.
A scope control has no such question in it: each box already knows whether it can hold a range.

### 3. Only windows a saved dashboard could have held

Range offers `current`, `fy_to_date`, and `last_n` at 3, 6, 12 and 24 — exactly the shapes
`widgetSchema` allows, with `n` inside its own 2–24 bound. Compare offers the three
`COMPARE_BASES`. So the lens can never ask for something the spec could not store, and a board
read through it is a board that could have been saved that way.

A financial year is read **to the anchor, not to today**: with the anchor on May and a year
starting in April, "financial year to date" is two months. The reader is looking at May.

### 4. The legend is pinned to one row

Making comparison available to every reader made a six-series trend ordinary rather than rare,
and the chart's grid reserves a fixed 26px for its legend. A wrapping legend grew up into the
axis labels. The legend is now `type: "scroll"` — one row, with pages — so the reservation
holds at any series count.

## What this does not do

- **It does not add a third thing to the workspace.** The workspace is the board and the chat
  (ADR 0047); these are two selects in the header the month picker already sits in.
- **It does not replace the chat.** Asking for a box to be *saved* showing twelve months is
  still a dashboard change, still priced, still versioned. The lens is for looking.
- **It does not touch what a run costs or computes.** A monthly refresh on unchanged structure
  still makes no AI call.

## Tests

`packages/render-dashboard/test/lens.test.ts` (8): the saved board is unchanged when nothing is
chosen; a multi-month box retargets; a financial year reads to the anchor; **a `current` box is
byte-for-byte identical however wide the range is set**; a comparison box moves onto the chosen
basis and picks up the matching `yoy`/`mom` metrics; and no window asks for a month the company
does not have.

`apps/web/e2e/mis.spec.ts`: on a real board, Range widens the trend and leaves the working-capital
table on its month, Compare draws last year and takes it away, **the AI call count is unchanged**,
and a reload comes back to "As saved".
