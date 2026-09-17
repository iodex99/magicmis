# Plan: the public site — findable, and worth returning to

The product is built and the app works. The front door does not: one page, one paragraph of
metadata, no sitemap, no robots file, no structured data, no share image, not even a
favicon. Nothing about it would rank, and nothing about it invites a second visit.

This plan covers the public surface only. Nothing here touches the signed-in app, the
charging path, or the trust boundaries.

## What the audience actually types

Researched 2026-09-16 against live search results rather than assumed. Sources recorded
because §0.4 requires it for external facts, and keyword intent is an external fact.

| Query family | What the searcher wants | Our page |
|---|---|---|
| "MIS report format in excel", "monthly MIS report format" | A **template**. Huge volume, mostly template downloads on caclubindia and Excel-template sites ([1](https://www.caclubindia.com/share_files/mis-report-in-excel-27032.asp), [2](https://exceltmp.com/mis-report-format-in-excel/)) | `/mis-report-format` — what an MIS actually contains, section by section, on fictional figures |
| "MIS report in Tally", "how to prepare monthly MIS from Tally", "export Tally to Excel automatically" | To get management reporting out of Tally without doing it by hand ([3](https://www.techjockey.com/blog/mis-report-in-tally-and-excel), [4](https://www.easyreports.in/2025/02/26/how-to-prepare-monthly-mis-from-tally-bi-tools/)) | `/tally-mis-report` — the exports to take, and what happens to them |
| "MIS report for CA firms", "management reporting for clients" | A practice serving many clients monthly | `/for-ca-firms` |
| Brand / evaluation | Is this safe, what does it cost, how does it work | `/product`, `/how-it-works`, `/security`, `/pricing` |

The first two families are *informational*, not commercial. That is the point: a firm
searching "MIS report format in excel" is doing the job by hand this month. The page has to
answer the question well enough to be worth the click, and let the product follow from it.
A thin page that only pitches will not rank and would not deserve to.

`/product`, `/how-it-works` and `/security` are already in `DEVICE_AGNOSTIC_PATHS` — the
marketing site was always meant to be more than one page.

## Rules this work must not break

- **§2.3, nothing is free.** Marketing samples are permitted on **fictional data only**.
  Every figure on every public page is invented and labelled as such. No sample is ever
  computed from a visitor's data, and no public page offers analysis.
- **§32 forbids "magic" wording** in customer-facing copy.
- **§2.13 desktop-only** is for the *app*. Marketing pages stay responsive to phone width,
  and every new page goes in `DEVICE_AGNOSTIC_PATHS` or a phone gets the gate instead.
- **§0.5, no hardcoded business numbers.** Any price shown reads from the price book.
- **R-01**: the product name is still a placeholder. Copy uses `PRODUCT_NAME`, never a
  literal, so the real name remains a one-line change.
- **No fabricated social proof.** There are no customers yet, so there are no testimonials,
  no logo wall, no "trusted by N firms". Inventing them would be a lie told at scale, and
  it is the one thing on a marketing site that cannot be quietly corrected later.
  Credibility comes from specifics instead: what the product does, what it refuses to do,
  where the data goes, and what a real output looks like.

## The work

### 1. Technical SEO foundation

- `robots.ts` — marketing indexable; `/app`, `/api`, `/wallet`, `/settings`, `/sign-in`,
  `/auth`, `/signed-out` disallowed. A signed-in surface in the index is a support problem,
  not a win.
- `sitemap.ts` — the public pages, generated from one list so it cannot drift.
- Per-page `metadata`: title, description, canonical, OpenGraph, Twitter card.
- `opengraph-image` — generated, so a shared link is not a blank rectangle.
- `icon`, `apple-icon`, `manifest.ts`.
- **JSON-LD** — `Organization`, `SoftwareApplication`, `FAQPage`, `BreadcrumbList`.
  Under our strict CSP a `<script type="application/ld+json">` still needs the request
  nonce, so it goes through one helper that reads it rather than being sprinkled inline.

### 2. Pages

`/mis-report-format`, `/tally-mis-report`, `/for-ca-firms`, `/product`, `/how-it-works`,
`/security`. Each is a real answer to its query, each ends with the same honest next step,
and each carries its own metadata and breadcrumb.

### 3. Make it worth returning to

The current home page is a competent brochure. What it lacks is any sense of the thing
itself. So: show the product. A sample MIS on fictional data — the real numeric formatting,
the real lakhs/crores rendering, the real dashboard shapes — rendered with the same
components the app uses, so it is a demonstration rather than an illustration.

### 4. Verification

New E2E coverage: every public page renders, is reachable on a phone user agent, carries a
canonical and a title, exposes valid JSON-LD, and shows no figure that is not labelled
fictional. `sitemap.xml` and `robots.txt` are served. The existing CSP-violation watcher
covers the new pages, and the secret scan (R-54) already walks every route in the sitemap.

### 5. Solutions and guides (2026-09-17)

Buyer searches get their own pages, each written in the searcher's words and making no claim
the code does not enforce: `/ai-mis-report` ("MIS with AI", "AI MIS generator" — what AI
does and, as plainly, what it does not), `/mis-in-minutes` ("automate MIS" — minutes for the
refresh, and honest that the first month's mapping takes longer), `/automated-management-accounts`
(UK and Commonwealth wording) and `/monthly-financial-reporting` (US wording).

Practitioner questions go under `/guides`, with an index: KPIs and ratios with worked
formulas, trial balance to management report, debtors ageing, commentary and variance
analysis, and a month-end close checklist. The four guides written earlier keep their URLs;
moving a page that ranks throws the ranking away. `GUIDE_PATHS` and `SOLUTION_PATHS` in
`lib/seo.ts` order the index, and nested guides carry a Guides breadcrumb in both the page
and its JSON-LD. Vendor-specific export guides (Xero, QuickBooks Online, Zoho Books) are
deliberately not written until their menu paths are verified against each vendor's own
documentation (SPEC §0.4).
