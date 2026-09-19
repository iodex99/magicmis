# ADR 0051: Sample dashboards on the site, and no sample MIS to download

**Status:** accepted · **Date:** 2026-09-19 · **Decided by** the product owner · **Amends** ADR
[0038](0038-every-name-the-report-goes-by.md) (the `/mis-report-template` page and its workbook)

## Context

The owner: _"Remove the 'sample MIS' also and all its related texts, since now we only have a
dashboard and we present it on the website only, it's no longer needed. Instead we can have a
horizontal flowing carousel of the sample dashboards, one from right to left and one from left to
right."_

Since ADR 0046 the dashboard is what a customer builds, changes by chatting and presents. The
public site still led a doubtful visitor to a workbook download: a button on the home page, a
second button in the call to action in the middle of every guide, a footer link, a line in
`llms.txt`, a sentence in the pricing questions and a whole page, `/mis-report-template`.

One thing found on the way: the workbook itself, `public/samples/sample-monthly-mis.xlsx`, was
never in git, because `*.xlsx` is ignored. The download worked on this machine and would have
been a 404 on any deployment.

## Decisions

1. **The sample MIS is removed from the public site.** The page, the file, both buttons, the
   footer link, the `llms.txt` line and the sentences that mentioned it are gone. The pricing
   answer now points at the sample dashboards. The call to action inside guides offers "See a
   dashboard" (`/mis-dashboard`) where it offered the download.
2. **The old address moves for good.** `/mis-report-template` ranked and may be linked from
   outside, so it and `/samples/*` answer with a permanent redirect to `/mis-dashboard` rather
   than a 404. The page leaves `PUBLIC_PAGES`, the guide list, the sitemap and the device gate's
   list of public paths.
3. **The home page shows sample dashboards in two drifting rows.** `DashboardCarousel` sits under
   the tour. The first row moves right to left and the second left to right. Ten invented
   companies across trades, currencies and scales (dollars, pounds, euros, dirhams, Singapore
   dollars, rupees in lakhs and in crores), because "its own currency" is a claim the product
   makes (ADR 0034) and a row of boards shows it faster than a sentence.
4. **Drawn, not photographed.** The boards use the chart components the product uses. Both themes
   work, nothing can ever be a picture of a real account, and the section says on the page that
   the companies and every figure are invented (SPEC §2.3; the existing E2E rule still holds).
5. **The motion obeys ADR 0036.** One CSS animation, no script. Each row is laid out twice and
   slides by exactly one copy; the second copy is hidden from assistive technology. It pauses
   under the pointer so a board can be read. There is no fade at the edges, because a fade is a
   gradient. Under reduced motion nothing moves, the second copy is not rendered and the row
   scrolls by hand. The rows never make the page scroll sideways.

## Not changed

- A run still delivers a workbook to the customer, and the pages that describe that output still
  say so. The owner's instruction was about the public sample; removing the workbook from the
  product would be a separate decision.
- `packages/render-excel/scripts/sample.ts` stays. It is a development tool for looking at how a
  workbook is typeset and never fed the site from a build.

## Tests

`apps/web/e2e/public-site.spec.ts`: two rows, five boards each to a reader, one running `normal`
and one `reverse`, both moving; no sideways page scroll; no mention of a sample MIS on the home,
product, pricing or glossary pages; the old address answers 308 to `/mis-dashboard`; under
reduced motion neither row animates and ten boards remain visible. The page lists in
`public-site.spec.ts`, `secrets.spec.ts` and `seo.test.ts` no longer carry the removed paths.
