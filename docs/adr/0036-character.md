# ADR 0036: Character — motion, a display face, and texture, inside the same rules

**Status:** accepted · **Date:** 2026-09-18 · **Decided by** the product owner · **Extends** ADR
[0026](0026-ui-redesign.md) (the interface redesign) and ADR [0034](0034-one-currency-boardroom-reports-dark-mode.md)

## Context

The owner: _"The ui ux still looks very basic, make it cooler."_

The interface was correct and calm — ADR 0026's brief — but everything appeared at once, sat
flat on a plain ground, and read in one typeface at one weight. "Basic" was a fair word for it.

SPEC §32's rules still hold: a restrained neutral palette, one indigo accent, red and green only
for variance and always with a sign, tabular numerals on every figure, **no gradients and no
glows**, and nothing that reads as "magic". Character had to come from somewhere else.

## Decision

It comes from four things, none of them colour.

### 1. A display face

Headlines and page titles are set in **Space Grotesk** (self-hosted through `next/font`, so the
CSP's `font-src 'self'` holds), tight-tracked, through the `.display` class. Body text and every
figure stay in Inter: the tabular numerals SPEC §32 asks for are Inter's, and a figure that changed
face would change width.

### 2. Motion

Things arrive rather than appear, and answer a press:

- **`.rise`** — cards, hero copy and steps rise in with a stagger set by `--i`.
- **`RollingNumber`** — a headline figure rolls in a character at a time. The string is already
  formatted by the company's conventions; the component only wraps characters (through
  `Intl.Segmenter`, so nothing is split inside a grapheme) and labels the whole for a screen
  reader.
- **Charts draw themselves** (`animationDuration` in the shared frame) and the public site's
  illustration draws its line once with a stroke-dash animation.
- **`.lift`** on cards under the pointer, **`.press`** on every button, typing dots while the
  assistant works, a soft ping on the "checks passed" mark.

All of it collapses to nothing under `prefers-reduced-motion`, which the stylesheet already
honoured.

### 3. Texture and depth

The working canvas carries a faint **dot grid** so cards sit on something. It is an SVG mask over
a token colour — a pattern, not a gradient — theme-aware, and absent in print. Cards keep one
border and one shadow; hover adds the medium shadow and a lift, nothing more.

### 4. Detail where the eye lands

KPI cards carry a twelve-month **sparkline** in the header (chart values only; the figure on the
card is what is read) and their movements as **pills with an arrow**. The rail marks the current
item with a bar and tints its icon; the credits card lifts and its arrow moves. Empty states get a
ringed tile. Loading breathes as a skeleton instead of saying "Loading". The public hero underlines
its last words with a drawn stroke and its illustration shows a line being computed.

## What was refused

Gradients, glows, glassmorphism and particle backgrounds were considered and refused: SPEC §32
rules them out by name, and each would have bought "cool" by making figures harder to read. The
one place a gradient function appears is a CSS `mask-image` on the dot grid, where it is the
mechanism for a dot and not a visible gradient. There is no "follow the system" theme setting
either, for the reason given in ADR 0034.

## Consequences

- One more typeface is self-hosted (Space Grotesk, three weights); no runtime request leaves the
  origin.
- `.rise` staggers by `--i`; a list that renders many cards should cap the index it passes so the
  last card does not wait seconds.
- Every animation is CSS; nothing here runs on a timer in JavaScript except the assistant's seconds
  counter, which is honest about a wait rather than decorative.
