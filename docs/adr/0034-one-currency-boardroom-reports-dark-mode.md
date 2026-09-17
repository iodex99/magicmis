# ADR 0034: One currency on every surface, reports fit for a board pack, and a dark theme

**Status:** accepted · **Date:** 2026-09-18 · **Decided by** the product owner · **Amends** SPEC §24.1
(workbook presentation), §24.2 (dashboard presentation) and §32 (the dark surface is navigation
only)

## Context

The owner opened a company whose books are in US dollars and found the dashboard writing `₹13.30`
on a card while the same figure's lineage said `$13.30`: _"somewhere it says 13 rupees and
somewhere it says 13$, there should be no such ambiguity."_ They also asked for the layouts to be
built properly, for **both** report surfaces — the dashboard on screen and the downloadable Excel
workbook — to be boardroom ready, and for a dark mode.

The cause of the currency split was a default. `formatValue(value, unit, money, currencySymbol =
"₹")` and `companyFormat(money)` let every caller that had not been updated write rupees, so the
lineage panel (which passed the symbol) and the widgets (which did not) disagreed inside one card.
The engine's facts pack had the same shape of default, which is how a dollar company's facts
reached the model in rupees.

## Decision

### 1. The currency symbol is required, everywhere

`formatValue`, `companyFormat`, `buildFactsPack`, `retrieveFacts` and `renderWorkbook` all take the
company's symbol with **no default**, so a caller that does not have one fails to compile. The
symbol comes from `companies.currency` through `currencySymbol()` (ADR 0030) on every path:
dashboard, assistant, commentary, lineage, chat facts and workbook.

Scale is stated rather than assumed. The `millions` style divides by a million and shows no
suffix, which is what a company that chose it expects in its own MIS but is ambiguous on a card,
so the dashboard toolbar carries **"Amounts in $ millions"** and the workbook says it on the cover
and under every sheet title. Chart axes use `compactMoney`, which shortens in the company's own
currency and grouping (`₹1.25 Cr`, `$12.5m`), so an axis can never disagree with the card above it.

### 2. The workbook is typeset

`packages/render-excel/src/theme.ts` holds the presentation: a title band on the cover with the
facts that identify the workbook, a dark header band over every table, no gridlines, frozen panes,
ruled subtotals and double-ruled totals, headings left over words and right over figures, column
widths, A4 landscape fitted to width, and a footer on every printed page carrying the company, the
report, the month, the disclaimer and a page number. Checks carry a status fill as well as the
word. The Index says what each sheet holds.

Nothing in the theme touches a value or a formula; V11 still pairs every formula cell with the
engine's value, and `test/presentation.test.ts` pins the presentation so it cannot quietly regress.

### 3. The dashboard is a report, and prints like one

Charts are drawn into a card-sized box (a definite height, and a `ResizeObserver` so the assistant
opening beside them does not leave a stretched canvas), with one palette, faint rules, no chart
junk, and tooltips that show the same formatted figures as everything else. KPI cards lead with the
figure and name their comparisons. `@media print` drops the navigation, the assistant and every
control, keeps cards whole across page breaks, and prints the month and units as a heading — so
**Print or save as PDF** on the workspace produces a page for a board pack.

### 4. Dark mode

A `theme` cookie (`light`/`dark`) is read by the root layout and written as `data-theme` on
`<html>`, so the first paint is already correct and there is no flash. The toggle sits in the
navigation rail.

The dark palette **inverts the neutral ramp** rather than replacing it: `text-neutral-900` is still
"the darkest text", `bg-neutral-25` still "the faintest surface", so every existing utility adapts
without being rewritten. Literal `bg-white` became `bg-surface`, a semantic token alongside
`canvas`, `raised` and `line`. The accent keeps its 600 step — a primary button is the same indigo
in both themes — while its tints darken and its text steps lighten. The navigation rail pins the
four neutral steps it writes labels in, because it is dark in both themes. Charts read their
colours from the page's CSS variables and redraw when the attribute changes.

There is deliberately **no "follow the system" setting**: the server renders the first paint and
cannot know the operating system preference, and guessing it in a script after paint is the flash
this design avoids.

This amends SPEC §32's "the dark surface is navigation only and never sits under figures". In dark
mode figures do sit on a dark ground, at the owner's request; the palette keeps body text and
figures at AA contrast on `--color-surface`, and variance still carries a sign as well as a colour.

## Consequences

- Any new display path must state the currency; there is no silent rupee any more.
- `packages/render-excel/scripts/sample.ts` renders a sample workbook from fixtures for looking at
  the typesetting (development only).
- Light and dark are two surfaces to keep working; the E2E suite runs light, and the dark palette
  is a token swap rather than a second set of components, which is what keeps that cheap.
