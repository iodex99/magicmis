# ADR 0042: One product from site to sign-in, a quieter security page, and files for the machines that read us

**Status:** accepted · **Date:** 2026-09-18 · **Decided by** the product owner · **Extends** ADR
[0036](0036-character.md), ADR [0032](0032-server-side-processing.md) and the public-site plan
([seo-marketing](../plans/seo-marketing.md), §9)

## Context

Three requests. The sign-in, sign-up and signed-out screens and the workspace "look quite
different from the actual main website" and should feel like one flow. The security page should
not tell people our stack or which AI we use: "keep it minimal". And the site should have an
`llms.txt`, a `robots.txt` "and more" for search.

## Decisions

### 1. The sign-in screens are half rail, half canvas

The marketing site had a character — display type, a dot-grid canvas, things that rise and draw
— and the auth screens had none of it: one small card on blank grey. They are now a split
screen. One half is the **ink of the app's rail**, with the mark in the rail's own corner, the
mark's line drawn once, and a few words that change with the moment (coming back, joining,
confirming, arriving, leaving). The other half is the **same dot-grid canvas** the site and the
workspace stand on, with the form rising into it.

That is the flow: site (canvas) → sign-in (ink beside canvas) → workspace (ink rail beside
canvas). Signing in reads as the panel folding down into the rail, not a jump between products.
The ink carries words and the mark only, never a figure (SPEC §32).

Sign-up is three screens, so those three show where you are: **Account · Confirm email · First
company**. Every label, button and heading the tests and the muscle memory rely on is unchanged.
The placeholders no longer suggest a country (`you@firm.com`). In the workspace, page headers
gain the small eyebrow line every page of the site has.

### 2. The security page says what a buyer needs, and nothing about how it is built

Gone: the AI vendor's name, the cloud key-management product, the hosting region, the
description of the ledger's database permissions and hash chain, and the mechanics of
break-glass access. Naming the stack tells a reader nothing they can act on and tells an
attacker where to start. The same names came off `/ai-mis-report` and `/how-it-works`.

Kept, deliberately: **what we do not claim** — no audit, no certification, files are on our
servers while kept, one sign-in factor. A security page that lists only strengths is not
evidence, and these are the questions a careful firm asks anyway.

**Not changed, and why:** the privacy notice still lists processors and locations, and the
processing-consent notice still names the AI processor. Data-protection law requires the first
(GDPR Art. 13–14; DPDP Act notice requirements) and consent is not informed without the second.
The security page now points to the privacy notice for "who else processes my data". An E2E test
holds the line: no page outside `/legal` may name a vendor.

### 3. Files for the machines that read us

`robots.txt`, `sitemap.xml` and the web manifest already existed. Added:

- **`/llms.txt` and `/llms-full.txt`** in the shape https://llmstxt.org specifies — H1,
  blockquote summary, plain paragraphs, H2 sections of `- [name](url): note`, an `Optional`
  section. Generated from `PUBLIC_PAGES`, like the sitemap, so a page cannot be added without
  appearing; a unit test pins the shape and the coverage.
- **AI crawlers named in `robots.txt`** — GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot,
  Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User, Google-Extended,
  Applebot-Extended, CCBot — with the same private paths disallowed. People now ask an assistant
  which tool to use; being readable by the thing that answers is the same bet as being readable
  by Google. A named group _replaces_ `*` for that agent, so the private list is repeated.
- **The tour in the sitemap** as a video entry on `/` and `/how-it-works`
  (https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps).
- **`/.well-known/security.txt`** (RFC 9116), built from the configured support address. It
  answers **404 until a real address is set** (R-02): a placeholder contact swallows reports.
- The manifest's language is `en`, and it lists the icons.

## What was refused

IndexNow: it needs a key file and a ping on every deploy, and only Bing and Yandex read it —
worth doing once there is a production domain (R-01), not before. `humans.txt` and similar:
nothing reads them.

## Consequences

- A new vendor name on a public page fails E2E. If one ever has to be named publicly, it goes in
  the privacy notice.
- `AuthShell` takes a `moment`; a new auth screen that omits it gets the "welcome back" panel.
- `llms.txt` is served from a static route and cached for a day; it changes when `PUBLIC_PAGES`
  does.
