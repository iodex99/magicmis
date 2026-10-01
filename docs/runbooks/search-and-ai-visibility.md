# Search and AI visibility, once the site is live

What ADR 0079 could not do before the domain existed. Do these in order after the pre-launch
deploy ([pre-launch](pre-launch.md)). None of them needs a developer except where it says so.

## In the first week

1. **Run the ten questions.** Write down ten questions a real buyer would type, in their words,
   including the awkward ones about price. For example:
   - "software to make MIS report from Tally"
   - "management accounts software UK small business"
   - "AI tool for monthly financial reporting from trial balance"

   Ask each one **logged out, in a fresh chat**, in ChatGPT, Perplexity and Claude. For each
   answer:
   - write down every business named, and in what order;
   - open **Sources** and note where the answer came from;
   - run any question that names us twice, because answers vary between runs.

   Repeat monthly in the same sheet.
2. **Check the crawler reaches us.** In Vercel's logs, filter by user agent for `OAI-SearchBot`,
   `ChatGPT-User`, `ClaudeBot` and `PerplexityBot`. Pages should appear within a few weeks of the
   sitemap being submitted. If they never do, check `robots.txt` on the live domain.
3. **Submit the sitemap** in Google Search Console and Bing Webmaster Tools.

## Monthly, from the second month

4. **People Also Ask capture.** For each of the five main searches, expand Google's People Also
   Ask box and write down every question:
   - MIS report
   - management accounts
   - monthly financial reporting
   - MIS report format
   - trial balance to MIS

   Triage each one:
   - **Reject** it if our buyer would not ask it.
   - **Fold** it into an existing page as a heading if a page already aims at it.
   - **Absorb** it into a page that gives the same answer.
   - **Build** it only if it is a distinct question with a distinct answer.

   A built one is a new entry in `ANSWER_PATHS` (ADR 0079): a developer adds the page.
5. **Search Console before each new page.** If the target page already gets clicks, add the
   phrases it ranks on page two for as headings on that page. If it gets none, build the new
   page.
6. **Stuck pages.** Filter Search Console for **Crawled, currently not indexed**.
   - For each page that matters, link to it from a page that already gets traffic.
   - If it is still stuck a month later, republish it at a narrower URL and 301 the old one.

   **Discovered, currently not indexed** is fixed by a link, not a new URL.

## What not to spend on

The playbooks tested these and found nothing:

- a LinkedIn company page;
- domain authority;
- more schema;
- page speed past where it already is;
- word count;
- publishing pages a crawler cannot read;
- disavowing links we did not buy.
