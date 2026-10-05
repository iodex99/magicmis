# 0081 — The words every market types

- **Status:** accepted
- **Date:** 2026-10-05
- **Decided by:** the product owner, who asked for keyword research "for all regions… we want to
  capture them all", the West first and India not forgotten, then chose to build the retitles and
  the ten most valuable pages now, and added the Indian accounting systems.
- **Builds on:** [0038](0038-every-name-the-report-goes-by.md),
  [0039](0039-raw-data-and-the-words-the-market-types.md),
  [0079](0079-written-to-be-repeated.md).

## Context

The research ([seo-keywords.md](../plans/seo-keywords.md)) ran about 450 phrases through Google
and Bing autocomplete per country, live searches and forty competitor home pages. It found that
the phrases the site was built around — "AI MIS", "MIS with AI", "MIS in minutes" — are barely
typed, that Google reads "AI management accounts" as sales account management, and that the
largest gap in the West is the accounting system's name: management accounts from Xero,
QuickBooks and Sage.

## Decision

- **Seven pages retitled** to the words with demand, keeping the old promise in the H1: MIS
  automation, an AI tool for MIS reports, AI for monthly management accounts, board pack and
  board packet, client reporting for accounting firms and CAS teams, and two smaller ones.
- **Twenty-one existing pages gained sections** under the headings the research lists, each a
  sentence worth quoting (ADR 0079).
- **Fourteen new pages**, each registered in `PUBLIC_PAGES`, the desktop list and both end-to-end
  lists, and linked from the nearest page that already has readers:
  - the West's systems: management accounts from Xero, QuickBooks and Sage 50;
  - India's: MIS report from BUSY, Marg ERP, Zoho Books and Vyapar (Tally already had a page;
    Tally.ERP 9 is served by it, and myBillBook, Giddh, Saral and Miracle showed no demand);
  - two comparisons, Fathom and Syft Analytics alternatives;
  - trial balance to financial statements, a financial dashboard from Excel, management
    accounts commentary examples;
  - two one-question pages: can AI prepare financial statements, and is it safe to upload
    financial statements to ChatGPT.
- **Every external fact is sourced and dated.** Menu paths come from each vendor's own help
  pages (SPEC §0.4), listed in each page's header comment; where a path could not be verified the
  page describes the step without one. Competitor statements come from the competitor's own site,
  read on 2026-10-05, listed on the page, with pricing given as a model and never a figure.
  ChatGPT's data handling is quoted from its maker's help pages without naming the maker, whose
  name the vendor rule (ADR 0042) keeps off every public page.
- **Comparisons are fair.** Each says what the competitor does that this product does not —
  syncing, forecasting, consolidation, cash flow — and who should choose it.

## A false claim found and removed

Several pages said the workbook contains a cash flow statement. It does not: the template
(`packages/templates/src/monthly-financial-mis.ts`) holds a P&L with year to date, a balance sheet
summary, ratios, receivables and payables ageing, and a payroll summary when payroll data is
present. Every claim about what this product produces now says exactly that; where cash flow
appears, it describes what an MIS commonly contains or what a competitor offers. Stale claims that
the dashboard prints to PDF (removed by ADR 0046) were corrected at the same time.

## Not built, and why

The other ten proposed pages (Spotlight and Reach alternatives, fractional and virtual CFO pages,
the management-accounts cost question, MYOB, Tally AI, the investor MIS and the Hinglish
experiment) wait until the site is live and Search Console shows which of these earn clicks.
