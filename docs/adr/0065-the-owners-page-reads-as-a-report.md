# ADR 0065: The owner's page reads as a report

**Status:** accepted · **Date:** 2026-09-23 · **Decided by** the product owner ("make the
dashboard cleaner and easier to understand, I want all the details but easier to understand,
also it looks very simple at the moment" — of the console the owner uses to track everything) ·
**Builds on** ADR [0055](0055-the-owners-business-page.md), ADR [0036](0036-character.md)

## Context

`/business` had every figure the owner needs and showed them as twenty equal tiles in five equal
bands, with figures set in a monospace face and trends drawn as near-black slabs. It read as a
debug view of a report rather than the report.

Three things were wrong, and none of them were the numbers.

## Decisions

### 1. Figures are figures

`Stat`, the tables and the token counts set their numbers in `font-mono`. The house rule is that
figures never leave Inter's tabular numerals (ADR 0036) — the customer's workbook and dashboard
already follow it — and a monospace face makes money look like a log line. They are now Inter,
tabular, semibold and tighter.

### 2. The bars use the accent, not the navigation ink

`bg-neutral-800` made each bar a near-black slab. The dark `ink` surface is navigation only and
never sits under figures (ADR 0036); at chart size it reads as a rendering fault rather than a
bar. Bars are now `accent-200`, with the **last period in `accent-600`** because that is the one
the reader came for, over a baseline rule, and capped in width so two periods do not stretch
across the panel.

**One period is not a shape.** A single bar filling a chart says "chart" and shows nothing a
sentence would not say better — and early in a product's life that is the common case, not the
odd one. A one-point series now renders as *"315 in Sep 26 — the only period with anything in it
so far."*

### 3. Each band says what it answers, and which figure answers it

Every section carries a one-line question, and exactly one `Stat` per section is marked `lead`:
Accounts, Companies, **Revenue recognised** (not cash collected — recognised is what was
earned), Consumption run rate, Share of revenue. A lead tile takes the accent and a size step.
Twenty tiles of identical weight are twenty facts with no argument; five leads make the page an
argument with its details attached.

Under each trend, a `Delta` states the change between the last two points of that series —
derived from the series the chart draws, so the sentence and the picture cannot disagree.

Five bands is a page read in parts, so it opens with anchors to them.

## What this does not do

- **It removes no figure.** Every number that was on the page is still on it; this is about
  which ones are loud.
- **It does not touch `business.ts`.** No new query, no new metric, and the delta is computed
  from a series the page already had. A metric is still added in the server module, never on the
  page (ADR 0055).
- **It does not change the gate.** Same app, same allowlist, same TOTP.
