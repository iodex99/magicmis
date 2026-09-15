# ADR 0026: Interface redesign — indigo accent, a navigation rail, and a summary layer

**Status:** accepted · **Date:** 2026-09-15 · **Revises** the palette and radius chosen in Phase 0 (`packages/ui/src/tokens.ts`) and the visual direction in SPEC §32

## Context

The product owner reviewed the running app and judged the interface basic, supplying a
reference screenshot of a violet/navy finance dashboard as the direction to aim at.

The app was correct and lifeless. Every screen was a stack of white panels holding 13px
tables: no hierarchy, no summary layer, no current-page state in the navigation, status
rendered as raw identifiers (`awaiting_review`), empty states that were bare sentences,
and — the detail that made everything else look worse — `--font-sans` named Inter while
nothing ever loaded it, so every screen actually rendered in Segoe UI.

The reference conflicts with SPEC §32 on one point. §32 rules out "purple-blue gradients",
and the reference is built on them.

## Decision

Take the reference's craft; leave its gradients.

### 1. The accent moves from teal to indigo

SPEC §32 asks for "a restrained neutral palette with one accent colour" and does not name
the colour. The Phase 0 tokens chose deep teal partly *because* it was distant from the purple-blue
the spec rules out. That reasoning confused a hue with a treatment: the prohibition is on
purple-blue **gradients**, and a flat indigo is not a gradient.

Indigo `#6c5ce7` (accent 500), with `#5846d2` for the primary action, which holds AA
contrast against white. One family, one accent, no second chromatic ramp. The token test
now enforces this by measuring chroma rather than by counting keys.

### 2. A dark navigation rail, and figures stay on white

The reference's dark panel is adopted as a 240px navigation rail on a new `ink` ramp
(`#141029`–`#413c73`). The rule attached to it: **navigation and framing may be dark, data
never is.** Reading dense figures on a dark ground costs accuracy over a long session, and
this audience reads figures all day.

The rail also carries the available credit balance on every page. This is a prepaid
product (SPEC §2.4); knowing what is left is part of deciding whether to start a paid
action, and making the customer navigate to the Wallet to find out was the wrong answer.

### 3. Radii grow; the blob prohibition is read correctly

Cards 16px, controls 10px, pills fully round. "No rounded gradient blobs" prohibits a
decorative shape, not a corner radius. The token test now bounds corners at 20px and
asserts that the `full` step is exactly the pill value, so the rule still has teeth.

### 4. Every screen opens with a summary layer

Stat cards with a figure, an optional movement (arrow **and** colour, never colour alone)
and a small inline chart. Charts are hand-drawn SVG in `components/Charts.tsx` — a
sparkline, mini bars and a donut, each `aria-hidden` beside a figure already stated in
text. ECharts still renders the real dashboard, where a reader interrogates data rather
than glances at it. No new dependency.

Proportions for the donut are computed in bigint through `sharePercent`, so no amount ever
passes through a float (SPEC §4).

What the cards may show is bounded by SPEC §2.3: counts of the account's own artefacts —
companies it created, workbooks it already paid for, credits it already bought. Nothing
that previews unpaid analysis.

### 5. Inter is actually loaded

Through `next/font/google`, which downloads at build time and serves from our own origin,
so the CSP's `font-src 'self'` holds and no request reaches a font CDN at runtime.

### 6. Icons are drawn here, not installed

A 41-glyph stroke set in `components/Icon.tsx`. No dependency, and no glyph we did not
choose — there is no sparkle, wand or star in the set and none is to be added (SPEC §32).
Icons accompany words; the one exception is `IconButton`, which requires an `aria-label`.

### 7. Status becomes a word in a pill

`awaiting_review` is now "Awaiting review" in a warning pill with a dot. The word carries
the state; the colour and dot reinforce it.

## Verified facts (2026-09-15)

| Fact | Source |
|---|---|
| `next/font/google` downloads font files at build time and self-hosts them; no request is made to Google at runtime. | https://nextjs.org/docs/app/api-reference/components/font |
| Playwright's `getByRole` `name` option matches a **substring**, case-insensitively, unless `exact: true`. This is why two links named "Wallet"/"…in the wallet" collided. | https://playwright.dev/docs/api/class-page#page-get-by-role |

## Consequences

- **Spec:** §32 updated — gradients ruled out wholesale, the dark-surface rule and the
  summary-layer requirement added, the accent named, a shape paragraph added, and the
  status-as-a-word rule written down.
- **Tokens:** `packages/ui/src/tokens.ts` gains the `ink` ramp, a wider radius and
  elevation scale, and an `eyebrow` type token. Its tests now measure chroma and bound
  corner radii instead of asserting the old teal-and-6px values.
- **Components:** `components/ui.tsx` grows from 5 primitives to 20 (Button, ButtonLink,
  IconButton, Panel, StatCard, Badge, Alert, EmptyState, Avatar, Progress, Field,
  SelectField, TextareaField, DataTable/Th/Tr/Td, PageHeader, Tabs, AuthShell, BrandMark).
  `AppFrame` becomes a shell with the rail; `PublicShell` is new.
- **Two E2E failures were the tests doing their job**, and both were fixed in the product,
  not the test:
  - The pricing page said "never charged for tokens, models or time". SPEC §2.5 forbids
    showing the customer the words *token* and *model*, and `wallet.spec.ts` asserts the
    page never contains them. Reworded.
  - A summary card hint read "Ledger and invoices in the wallet", which made a second link
    match `getByRole("link", { name: "Wallet" })`. Reworded, and the card is no longer a
    link.
- **One E2E selector changed and one assertion changed**, both because the redesign
  changed what it asserted, not to make a failure go away:
  - The company overview no longer repeats the workspace navigation as three large cards
    (the rail already holds those destinations), so `getByRole("link", { name:
    "Dashboard" })` is unambiguous again. The cards were replaced by four summary figures.
  - `ingest.spec.ts` asserted the exact string "No files loaded." The empty state now
    reads "No files loaded" with guidance beneath it; the assertion dropped the full stop.
- **Accessibility:** focus rings are defined for both surfaces (`.on-ink` raises the ring
  to `accent-300`), every icon-only control has an accessible name, `aria-current` marks
  the current page, and a `prefers-reduced-motion` block disables transitions.
- **No new runtime dependency.**
