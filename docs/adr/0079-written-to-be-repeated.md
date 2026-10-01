# 0079 — Written to be repeated

- **Status:** accepted
- **Date:** 2026-10-01
- **Decided by:** the product owner, who shared two Highprime Co playbooks and asked for "all of
  this" to be implemented: *How to get recommended by ChatGPT* (eleven days of experiments,
  logged out, server logs open) and *Nine SEO moves that still work* (from an SEO with 26
  years' practice, tested on their own site).
- **Builds on:** [0038](0038-every-name-the-report-goes-by.md),
  [0039](0039-raw-data-and-the-words-the-market-types.md),
  [0042](0042-one-product-from-site-to-sign-in-and-a-quieter-security-page.md),
  [0078](0078-the-site-before-the-product.md).

## Context

Both playbooks rest on one observation. Neither Google nor an AI assistant judges a page's
quality. Google counts links and clicks. An assistant skims the page for a plain answer and
repeats it. So a page wins by putting a plain, specific, quotable answer where a skimmer meets
it first, and by being readable without running a script.

What the site already did:

- **The FAQ is in the page.** Every FAQ is server-rendered in real `<details>`, so the answers
  are in the HTML. The playbook's ten-second test passes by construction.
- **Robots are open.** `robots.txt` names OpenAI's, Anthropic's and Perplexity's crawlers and
  lets them in.
- **Titles are unbranded.** Every title but the home page's leaves the product name out.
- **Slugs are descriptive** and written in each market's own words (ADR 0038).

What it did not do:

- **Headings read like folder names.** About thirty pages closed on "Questions" or "Questions
  people ask", and others read "How it works", "What AI does" or "Six steps". The playbook
  found these are never quoted.
- **The home headline was a slogan.** "Turn raw data into insight you can act on" does not say
  what the product does.
- **There were no one-question pages**, the playbook's shipped move.
- **One promise was out of date.** The practices page still said client files are "deleted on
  schedule", which has been untrue since ADR 0047.

## Decision

### Lead with what nobody else says (ChatGPT move 02)

Four competitors' home pages were checked on 2026-09-30: Fathom, Syft, Spotlight Reporting
and Reach Reporting.

| Claim | Competitors who also make it |
|---|---|
| Accepts an Excel export | Fathom, Reach |
| AI commentary | Fathom, Spotlight, Reach |
| "Every number is traceable" | Fathom, word for word |

All three are wallpaper.

None of them makes these four claims, so the headings carry them:

- **The AI is not allowed to write a figure**, with the mechanism: blanks the engine fills, and
  a draft containing a number rejected.
- **No subscription**: pay per report, and credits never expire.
- **Month two is a refresh, not a rebuild**: no AI call on unchanged books.
- **No member of staff can open your file**, and every opening is logged.

### Say what it does, first (ChatGPT move 01)

The home H1 is now "Monthly MIS and management accounts from your trial balance." The slogan
moves to the subhead, which also carries the scarce claim. The home, product and how-it-works
titles say what the page is, instead of "How it works" and "What you get each month".

### Headings as sentences worth quoting (ChatGPT move 03)

Seventy headings across 27 pages were rewritten. Each states what its section already says, for
example:

- "No member of staff can open your file, and every opening is logged"
- "Three to five working days go on rebuilding the pack"
- "An MIS report and management accounts are the same document"

A unit test (`src/lib/headings.test.ts`) fails if a folder name comes back.

### One question, one page (SEO moves 01 and 02)

The site's own FAQs and the buyer questions around the report were triaged. A question a guide
already answered was folded into it as a heading; for example, "is an MIS report the same as
management accounts" became a heading on the what-is page. Six questions were built, each as its
own URL:

- `/how-to-make-an-mis-report-in-excel`. The how-to beside the format page's what-goes-in; the
  playbook keeps definition and how-to apart.
- `/how-often-should-an-mis-report-be-prepared`
- `/can-chatgpt-make-an-mis-report`. The scarce argument, in the words buyers type. It names a
  general chat assistant because that is the question, and nothing this product is built on.
- `/how-to-calculate-debtor-days`
- `/how-to-calculate-gross-margin-from-a-trial-balance`. Narrowed to the trial balance, per SEO
  move 04, and carrying the stock adjustment others skip.
- `/how-to-calculate-ebitda-in-an-mis-report`. Carries the argument that other income stays out.

On each page:

- The question is the title, the H1 and the URL, and the short answer comes before any button
  (`QuestionHeader`).
- Every formula is the engine's own (ADR 0020), so a page cannot contradict the product.
- Every example figure is marked as invented (SPEC §2.3).
- The parent guides link to it, because a link from a page with readers is how a new page
  gets crawled.

The pages are listed in `ANSWER_PATHS`, in llms.txt under their own heading, on the guides
index, in the device list and in both end-to-end page lists.

### Proved the way the crawler reads it (ChatGPT move 04)

An end-to-end test now loads every public page with JavaScript off, as OpenAI's search crawler
fetches it. On each page:

- the H1 must be there;
- every FAQ answer the page promises in its structured data must be in the text;
- on a one-question page, the short answer must follow the H1 directly.

## What was not done, and why

- **People Also Ask capture.** SEO move 01 builds the list from Google's People Also Ask box,
  which can only be read in a browser on a live results page. The six questions here came from
  triage, not capture. The capture is the first step of the
  [runbook](../runbooks/search-and-ai-visibility.md), once the domain exists.
- **Measuring where the site stands.** The ten logged-out questions, the server-log check and
  the Search Console moves all need the site live (ADR 0078). The runbook has them in order.
- **Keyword domains (SEO move 05).** The playbook marks it "handle with care". It works only for
  a real product with its own reason to exist, so nothing was bought.
- **Moves that were not ours to make.**
  - LinkedIn: the playbook found it does nothing.
  - Domain authority, schema volume, page speed, word count: no effect found.
  - Disavowing links: there are none to disavow.

## Consequences

- A new public heading has to say something. The test names the ones that may not come back.
- A new one-question page goes in `ANSWER_PATHS`, registered like any other public page, with
  its question as its title. A unit test holds the title, the H1 and the URL together.

## Sources

- The two Highprime Co playbooks the owner supplied, September 2026.
- Competitor home pages, fetched 2026-09-30: <https://www.fathomhq.com/>,
  <https://www.syftanalytics.com/>, <https://www.spotlightreporting.com/>,
  <https://www.reachreporting.com/>.
