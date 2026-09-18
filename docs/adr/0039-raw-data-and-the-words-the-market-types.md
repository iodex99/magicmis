# ADR 0039: Raw data, and the words the market types

**Status:** accepted · **Date:** 2026-09-18 · **Decided by** the product owner · **Extends** the
public-site plan ([seo-marketing](../plans/seo-marketing.md), §7) and ADR
[0038](0038-every-name-the-report-goes-by.md)

## Context

The owner asked two things: _"rather than calling it exports wouldn't it be better if we call
it raw data and position it that way"_, and for phrases like _"MIS with AI"_ and _"MIS in
minutes"_ to be researched and used properly.

"Exports" was the accounting system's word for the act of getting a file out. It described
the input from the wrong side — the software's — and it collided with two other meanings on
the same site: the zero-rated _export of services_ this business bills under (ADR 0030), and
the account data export under Privacy. "Raw data" describes the input from the customer's
side: what they already have, before anyone has done anything to it. It is also the phrase
the spreadsheet-AI market uses for the same thing. The research is in the plan with its
sources, per §0.4.

## Decision

1. **The input is "raw data".** Every customer-facing surface — hero, share cards,
   how-it-works, the solution and guide pages, the run screen, the reporting-conventions
   forms, the structured data — says raw data, raw trial balance or raw files, never
   "exports" as a noun.
2. **The verb stays where it is an instruction.** A guide that tells the reader how to get a
   report out of TallyPrime says "export", because that is the menu item. `docs/help/tally/*`
   and the steps on the Tally guide are unchanged.
3. **Two terms are not this word and are untouched**: "export of services" (the GST term,
   locked decision 14) and the account data export feature under Privacy (SPEC §8).
4. **The phrases the market types lead their pages.** `/ai-mis-report` is titled "MIS with
   AI"; `/mis-in-minutes` is titled for "MIS in minutes" and "automated MIS report". The home
   title carries the two market names and the positioning together: "monthly MIS and
   management accounts from your raw data".
5. **Three pages for the query families no page answered**, each in its market's vocabulary
   and each carrying `AlsoCalled`: `/ai-management-accounts` (UK), `/ai-financial-reporting`
   (US) and `/mis-dashboard` (India; fictional figures only, SPEC §2.3). They do not repeat
   the pages they neighbour: the AI pages are about the split between what AI does and never
   does in that market's words; the dashboard page is about lineage.

## What was refused

A page for "MIS in Excel with ChatGPT": the query wants a manual how-to, and a page written
to catch it would teach what the product exists to replace. Renaming the account data export
to avoid the word: it is a different feature with a legal meaning (SPEC §8), and the reader
who wants it is looking for that word.

## Consequences

- "Export" as a noun for the input is now a wording bug. Reviews of new copy should read for
  it.
- The three pages follow the ADR 0038 registration rule: `PUBLIC_PAGES`,
  `DEVICE_AGNOSTIC_PATHS`, both E2E path lists, `SOLUTION_PATHS` and the footer.
