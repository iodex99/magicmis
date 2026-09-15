# Plan — UI and UX redesign

**Trigger:** the product owner reviewed the running app on 2026-09-15 and judged the
interface basic, supplying a reference screenshot (a violet/navy finance dashboard) as
the direction to aim at.

## What is actually wrong today

The app is correct and dead. Every page is a stack of white `Panel`s holding 13px tables.
Specifically:

1. **No hierarchy.** A page title, then panels of equal weight. Nothing tells the eye
   where to start, so everything is read at the same speed — the opposite of what a
   dense finance tool needs.
2. **No summary layer.** The wallet has a balance, companies have lifecycle states, jobs
   have credits charged. None of it is ever surfaced as a figure you can read at a
   glance; it is all buried in table cells.
3. **Inter is declared and never loaded.** `--font-sans` names it; nothing fetches it, so
   every screen actually renders in Segoe UI.
4. **Navigation carries no state.** Five identical text links, no current-page marker, no
   company context, no account affordance beyond "Sign out".
5. **Empty and error states are bare sentences**, against SPEC §32's "every error and
   empty state says what to do next".
6. **Tables have no rhythm** — no hover, no sticky headers, no zebra, no alignment
   discipline beyond `tabular-nums`, and no column that is visibly the important one.
7. **Status is text.** `unsent`, `grace`, `awaiting_confirmation` render as raw words,
   sometimes with underscores still in them.

## Design direction

The reference is right about craft and wrong about palette for this audience. SPEC §32
rules out purple-blue gradients, glows and gradient blobs; it does not rule out depth,
generous radii, colour, or a dark surface. So:

**Taken from the reference**
- Stat cards across the top of every screen, each with a figure, a delta and a small
  chart (sparkline, bars, or a donut) drawn inline.
- A dark navigation surface against a light working surface.
- Pill-shaped status badges, segmented tab controls, avatars, circular icon buttons.
- Generous corner radii (cards 16px, controls 10px) and layered, low-opacity shadows.
- Split list/detail layouts where a list and a record are read together.

**Not taken**
- Gradients of any kind, and glows (SPEC §32).
- Dark surfaces under dense figures — numbers stay on white. The dark surface is the
  sidebar only.
- Decorative photography.

**Changed in the spec** (recorded in the ADR): the single accent moves from teal to
indigo, and the radius scale grows. "One accent colour" still holds.

## Work

| # | Step | Detail |
|---|---|---|
| 1 | Tokens | `packages/ui/src/tokens.ts` + `globals.css`: indigo accent, cool neutral ramp, ink ramp for the sidebar, radius and elevation scales, update the token tests. |
| 2 | Typography | Load Inter through `next/font` (self-hosted, so `font-src 'self'` holds). Display/heading/body/numeric scale. |
| 3 | Icons | A hand-drawn stroke icon set in `components/Icon.tsx` — no dependency. Icons always accompany a word (SPEC §32). |
| 4 | Primitives | Rewrite `components/ui.tsx`: Button (4 variants × 3 sizes), IconButton, Card, StatCard, Badge, Field, Select, Textarea, Checkbox, Alert, EmptyState, Tabs, Avatar, Progress, Skeleton, DataTable. |
| 5 | Charts | `components/Charts.tsx`: Sparkline, MiniBars, Donut — inline SVG, no dependency, `aria-hidden` with the figure stated in text. |
| 6 | Shell | `AppShell` replaces `AppFrame`: dark sidebar with current-page state, top bar with the credit balance and an account menu, page header with title/description/actions. Company workspace gets its own sidebar section. |
| 7 | App pages | Companies, company workspace, wallet, source files, job runner. |
| 8 | Public + auth | Marketing home, pricing, legal, sign-in/up, MFA, enrolment, recovery, desktop-required. |
| 9 | Settings | Profile, security, privacy. |
| 10 | Rich clients | Dashboard, commentary, chat. |
| 11 | Verify | Every E2E hook (`getByLabel`, `getByRole`, `data-testid`) preserved; full unit + E2E suites; CSP violation watchers stay empty. |

## Constraints held throughout

- SPEC §2.3: nothing paid is previewed. The new summary cards show only what the account
  already paid for or what is free (balance, counts, lifecycle state).
- SPEC §32: no emoji, no sparkle icons, no gradients, no glows, no "magic" wording.
- Variance colour is always paired with a sign or arrow.
- Every figure keeps tabular numerals and right alignment.
- WCAG 2.2 AA: focus rings, contrast, full keyboard operability.
- No new runtime dependency.
