# ADR 0044: A rail and a chat that fold away, and a chat that is never out of reach

**Status:** accepted · **Date:** 2026-09-18 · **Decided by** the product owner · **Extends** ADR
[0033](0033-one-workspace-no-price-step.md) (one workspace) and ADR [0036](0036-character.md)

## Context

The owner asked for the navigation rail and the chat to be collapsible — a dashboard beside a
chat wants every column it can get — with one condition on the second: _"this chat shall be
easily accessible from anytime anywhere (that is our revenue source)."_ And for a bug: when
editing the dashboard layout, the text in the rounded card "goes out of it".

## Decisions

### 1. The rail folds to a strip of icons, and the server knows

`Collapse navigation` (or Ctrl/⌘ B) takes the rail from 15rem to 4.5rem. Every item keeps its
name as its accessible label and tooltip, so nothing becomes reachable only by guessing at an
icon, and the balance stays visible as a number under a wallet icon — this is a prepaid product
and what is left is part of deciding whether to start something (SPEC §2.4).

The choice is a cookie (`rail`), like the theme (ADR 0034), so the server renders the width the
reader left. A layout preference kept in `localStorage` arrives after the first paint, and the
whole page jumps sideways when it does. It is written only once the reader has actually
chosen, never for the default, and holds one word.

### 2. The chat folds away; closing it never puts it out of reach

`Hide chat` gives the dashboard the whole width. Because the chat is what the product earns
from, there are four ways back, and one of them is always on screen:

- a **launcher** fixed in the corner of the workspace, however far the page is scrolled;
- **Ctrl/⌘ K**, which toggles it and puts the cursor in the question box;
- **Investigate** on any dashboard card, which opens it by itself with the question written;
- a **Chat with the MIS** button at the top of the rail, **on every signed-in page**, in either
  rail width.

The chat belongs to a company, so from a page that is not about one — Companies, Wallet,
Settings — the rail opens the chat of the company most recently worked on, arriving with the
panel open and the cursor in it. On that company's own workspace it opens in place, with no
navigation. An account with nothing set up is sent to add a company, which is the only honest
answer to "chat with what?".

The panel **stays mounted while hidden**. A conversation, or an answer still on its way, is not
lost by closing it — and an answer still costs what it cost, so it must not be thrown away by a
click on a chevron.

Below the wide breakpoint there is no room beside the dashboard, and the chat used to be stacked
a long scroll beneath it, which for the thing that earns the revenue is close to hidden. It now
floats over the corner instead, and a reader who has never chosen starts with it put away there
so it does not sit on top of the figures.

The preference is a cookie (`chat`) for the same reason as the rail, and every way of opening
records it — a first version forgot to on Investigate, so the chat a reader had just used was
closed again after a reload; the end-to-end test found it.

### 3. Edit controls are icons on their own row

In **Edit layout**, each card carried four words — Rename, Earlier, Later, Remove — beside its
title. On a narrow card, and the cards are narrowest exactly when the chat is open, they did not
fit and ran out through the card's rounded corner. They are now a row of their own beneath the
title: four icon buttons, each with its name as label and tooltip, the destructive one set
apart at the far end. The row wraps; the card cannot be overflowed by it.

This is held by a test that **measures** rather than looks: in edit mode, with the chat open,
every control's box must lie inside its card's box, and no card may scroll sideways.

## Consequences

- `AppFrame` makes one more query on pages without a company (the most recent one), and reads
  one cookie. The workspace page reads another.
- The rail's workspace item is now "Dashboard"; the chat has its own button above it.
- Three hand-drawn icons joined the set: `panel`, `pencil`, `arrow-left`.
- The chat's History control is an icon, to leave the header room for the subtitle now that it
  carries a third button.
