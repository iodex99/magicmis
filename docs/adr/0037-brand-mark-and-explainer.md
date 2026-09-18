# ADR 0037: The mark, its animation, and a motion explainer

**Status:** accepted · **Date:** 2026-09-18 · **Decided by** the product owner · **Extends** ADR
[0036](0036-character.md)

## Context

The owner asked for a logo to be used everywhere, an animated version of it, and a short motion
video explaining how to use the product — and for these to live in Claude Design as the design
system's brand section.

Until now the brand mark was a placeholder: three bars and a baseline on an indigo tile, drawn
twice (once in `BrandMark`, once in the favicon) with no wordmark treatment. R-01 (the apex
domain) is still open, and the product name may yet change with it; what follows is a mark that
would survive a rename, since its shape is the product and not the name.

## Decision

### 1. The mark

An **M that is also a rising line**: four strokes, up-down-up-down, the second peak higher than
the first and the line ending above where it began, with the sparkline's live endpoint as a
ring. A management report and its trend in one shape. It sits on the single accent in a tile
with an 18/64 corner radius; a mono version draws the M in `currentColor` for single-colour use.

The geometry has **one definition** — `MARK_PATH` in `apps/web/src/components/Logo.tsx` — and the
rail, the public header, the sign-in page, the favicon, the social image and the admin console
all take it from there (the console copies the path, since the two apps share no code by design).
The SVG files in `apps/web/public/brand/` are the same drawing exported for use outside the app,
with a README carrying the rules.

The wordmark is live text in Space Grotesk 600 with "MIS" in the accent, never an image, so it
follows the theme and stays selectable.

### 2. The animated mark

`LogoMark animate` draws the M as a stroke (`stroke-dashoffset`), then pops the ring in with a
small overshoot — about 1.4 s in total. It plays **once on arrival and never loops**: a logo that
keeps moving is a distraction on a screen full of figures. It collapses under reduced motion with
every other animation in the stylesheet.

### 3. The explainer

`docs/brand/explainer/index.html` is a ~46-second motion explainer that plays like a video: six
scenes on a JavaScript timeline, every movement in CSS, captions on a bar with a step counter.
Add a company · drop in the trial balances · get the MIS · ask the assistant · the promises. It
is recorded to `.webm` with Playwright's video recording (`scratchpad/record-tour.ts`) rather than
authored in a video tool, so a change to a scene is a change to markup and a re-record — and the
tour can always be shown live on a page as well as as a file.

Every figure in it is fictional and the closing card says so (SPEC §2.3). The video is not
committed to the repository; the source is.

### 4. Claude Design

The brand section for the design system — logo, animated logo, colours and type, components,
motion — is built as preview pages under `docs/brand/design-system/`, each carrying a
`@dsCard` marker, ready for `DesignSync`. Pushing needs a one-time `/design-login` from an
interactive session, which this build could not perform; the bundle is on disk for the owner to
push with one command.

## Consequences

- `BrandMark` stays as a name for what callers already use and delegates to `LogoMark`.
- A rename under R-01 changes the wordmark text and nothing else.
- The explainer's captions are the shortest version of the product story; the marketing pages
  should not say more than it does in fewer words.
