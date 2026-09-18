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

### 6. Every name the report goes by (2026-09-18, ADR 0038)

The site had a page for three vocabularies and nothing that said they were the same
document, nothing for the words a board or a US controller uses, and no answer to the
biggest query family of all — a template. Researched against live results, per §0.4:

| Term | Where it is searched | Source |
|---|---|---|
| MIS report, MIS full form, MIS in Excel | India and South Asia; also the Gulf | [Tally Solutions](https://tallysolutions.com/accounting/mis-report/), [myBillBook](https://mybillbook.in/blog/accounting/mis-report/), [Busy](https://busy.in/accounting/what-is-mis/) |
| Management accounts, management reporting, MI | UK, Ireland, Australia, NZ, South Africa | [Spendesk](https://www.spendesk.com/glossary/management-accounts/), [Bookcheck](https://www.bookcheck.co.uk/what-are-management-accounts), [OD Accountants](https://odaccountants.co.uk/resources/management-reporting/) |
| Board pack, monthly management pack | UK boards; CIMA's 10–20 page guidance | [AccountingWEB / CIMA](https://www.accountingweb.co.uk/business/financial-reporting/the-ideal-monthly-management-pack-cimas-view), [Convene](https://www.azeusconvene.com/en-gb/articles/what-is-a-board-pack), [AccountsIQ](https://www.accountsiq.com/blog/management-reporting-packs-explained-what-cfos-should-include-every-month) |
| Month-end reporting package, monthly reporting pack | US controllers and FP&A | [airCFO](https://www.aircfo.com/tools/month-end-reporting-package), [The CEO's Right Hand](https://theceosrighthand.co/the-importance-of-the-month-end-reporting-package/), [Pacera](https://pacera.com/knowledge-hub/blogs/the-monthly-reporting-pack-what-to-include/) |

What changed:

- **Five pages**: `/what-is-an-mis-report` (the glossary and hub: meaning, contents, MIS vs
  financial statements, the table of names by market), `/mis-report-template` (a complete
  sample month to download, rendered by the product from the synthetic fixtures — §2.3
  permits a public sample on fictional data), `/board-pack`, `/month-end-reporting-package`
  and `/management-reporting-software` (the buyer's comparison query).
- **Every vocabulary page says the other names** through `AlsoCalled`, which links each term
  to the page written in it and to the glossary. `REPORT_NAMES` in `lib/seo.ts` is the one
  list.
- **Metadata that tells the truth about the audience**: each page carries a `locale`
  (`en_IN`, `en_GB`, `en_US`) used for the OpenGraph locale and the article language, and an
  `updated` date used by the sitemap and the article schema instead of the build time.
  `Organization.areaServed` lists the markets rather than India alone.
- **A share card per page** (`/og?path=`), carrying the page's own title, validated against
  `PUBLIC_PAGES`; an Apple touch icon from the same mark.

Not done, and why: vendor export guides (Xero, QuickBooks, Zoho) still wait on verified menu
paths (§0.4); `hreflang` is not used because the market pages are different articles that
share an intent, not translations of one article — cross-linking them is the honest signal.

### 7. Raw data, and the words the market types (2026-09-18, ADR 0039)

The site called the input "exports" — an accounting system's word for the act of getting a
file out, and one that also means the GST term this business bills under. The owner asked
for the input to be called **raw data** and positioned that way, and for the phrases the
market actually types — "MIS with AI", "MIS in minutes" and their kin — to be researched
and used. Researched against live results, per §0.4:

| Query family | What ranks today | Where it is searched | Source |
|---|---|---|---|
| AI MIS, MIS with AI, MIS from Tally with AI | Tally add-ons promising a "live MIS", and generic "make an MIS in Excel with ChatGPT" guides | India | [AI Accountant](https://www.aiaccountant.com/), [EasyReports](https://www.easyreports.in/), [Bricks](https://www.thebricks.com/resources/how-to-make-mis-report-in-excel-using-ai) |
| Raw data to dashboard, upload raw CSV | Spreadsheet-AI tools that phrase the input as "your raw CSV or Excel file" | Everywhere | [Bricks](https://www.thebricks.com/) |
| AI management accounts, management accounts with AI | General "AI in accounting" explainers from ledger vendors; no page that is the pack itself | UK, Ireland, Australia | [Xero](https://www.xero.com/uk/guides/ai-in-accounting/), [Wolters Kluwer](https://www.wolterskluwer.com/en-gb/expert-insights/ai-in-accounting), [befree](https://befree.com.au/) |
| AI financial reporting, financial reporting automation, monthly reporting automation | Enterprise close tools and SMB guides listing what to automate (cash, P&L vs budget, A/R aging) | US | [HighRadius](https://www.highradius.com/resources/Blog/ai-in-financial-reporting/), [Numeric](https://www.numeric.io/), [SuperDupr](https://www.superdupr.com/blog/financial-reporting-automation-small-business) |
| MIS dashboard, MIS automation, MIS in Excel dashboard | Analytics add-ons and Excel templates; "founders see the P&L twenty days after month end" | India | [BUSY](https://busy.in/), [WeAudit](https://weaudit.in/), [accountingtool.in](https://accountingtool.in/) |

What changed:

- **"Raw data" is the word for the input** on every customer-facing surface — hero, share
  cards, how-it-works, every solution page, the run screen, the conventions forms and the
  structured data. The verb survives where a guide tells the reader how to get a report out
  of Tally (`docs/help/tally/*`, the Tally guide's steps), and "export of services" is the
  GST term and untouched. The account data export under Privacy is a different feature and
  keeps its name.
- **The two phrases the owner named lead their pages**: `/ai-mis-report` is titled "MIS with
  AI"; `/mis-in-minutes` is titled for "MIS in minutes" and "automated MIS report", with "MIS
  automation" in the description. The home title now carries "monthly MIS and management
  accounts from your raw data".
- **Three pages for the families no page answered**: `/ai-management-accounts` (UK
  vocabulary; the honest split between what AI does and never does), `/ai-financial-reporting`
  (US vocabulary; starts from the raw trial balance, not a connector) and `/mis-dashboard`
  (the dashboard intent, shown on fictional figures per §2.3, with lineage as the difference).
  All three carry `AlsoCalled` and sit in the solutions list and the footer.

Not done, and why: no page for "MIS in Excel with ChatGPT" — that query wants a how-to for
doing it by hand, and a page written to catch it would have to teach what the product exists
to replace. "MIS software" as a bare term is owned by directory sites; the buyer's comparison
query is already `/management-reporting-software`.
