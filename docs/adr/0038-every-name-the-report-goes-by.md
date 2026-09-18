# ADR 0038: Every name the report goes by

**Status:** accepted · **Date:** 2026-09-18 · **Decided by** the product owner · **Extends** the
public-site plan ([seo-marketing](../plans/seo-marketing.md), §6) and ADR
[0030](0030-worldwide-two-currencies.md)

## Context

The owner asked for the SEO to be revisited — _"what different names are used in different
parts, we need to cover it all"_ — and for anything else the site could do better.

The site had three vocabularies (MIS report, management accounts, monthly financial
reporting) but nothing that said they were one document, nothing for the words a board or a
US controller uses, no answer to the largest query family in the Indian market — a template —
and metadata that told every crawler the audience was India. The research is recorded with
its sources in the plan, per §0.4.

## Decision

1. **One list of names.** `REPORT_NAMES` in `lib/seo.ts` holds each term, where it is used and
   the page written in it. `AlsoCalled` renders it under the header of every vocabulary page,
   so a reader who searched in one market's words and landed on another's page is told so in
   one line and handed the right one — and every term appears on every page.
2. **A glossary that is also the hub**: `/what-is-an-mis-report` answers "what is an MIS
   report", "MIS full form", "MIS vs financial statements" and "are management accounts the
   same as an MIS", with the table of names by market.
3. **The missing vocabularies get pages**: `/board-pack` (UK, Ireland, Australia; CIMA's
   10–20-page guidance) and `/month-end-reporting-package` (US controllers), plus
   `/management-reporting-software` for the buyer's comparison query.
4. **A sample to download.** `/mis-report-template` serves a complete month rendered by the
   product from the synthetic fixtures (`packages/render-excel/scripts/sample.ts` →
   `public/samples/`). SPEC §2.3 permits a public sample on fictional data and nothing else;
   the page says whose figures they are not.
5. **Metadata that tells the truth about the audience.** Each `PublicPage` carries a `locale`
   (`en_IN`, `en_GB`, `en_US`) for the OpenGraph locale and the article language, and an
   `updated` date the sitemap and article schema use instead of the build time.
   `Organization.areaServed` names the markets served; `SoftwareApplication` lists its
   languages and features.
6. **A share card per page** at `/og?path=`, carrying the page's own title and section, the
   path validated against `PUBLIC_PAGES`, cached for a day. An Apple touch icon from the same
   mark.

## What was refused

`hreflang` between the market pages: they are different articles that share an intent, not
translations of one article, and declaring them alternates would be a false signal.
Cross-linking them plainly is the honest one. Vendor export guides (Xero, QuickBooks, Zoho)
still wait on menu paths verified against each vendor's documentation (§0.4).

## Consequences

- A new public page must be added to `PUBLIC_PAGES` (which feeds the sitemap, metadata and
  breadcrumbs), `DEVICE_AGNOSTIC_PATHS`, and the two E2E path lists; the unit test that pins
  the first two to each other catches a miss.
- `AlsoCalled` belongs on any future page written in one market's words.
