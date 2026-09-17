/**
 * The public site as a search engine and a visitor actually meet it
 * (plan: docs/plans/seo-marketing.md, SPEC §32, §2.3).
 *
 * Everything here fails silently in production, which is why it is worth a test: a dropped
 * JSON-LD block costs a rich result with no error anywhere, a missing canonical hands a
 * crawler the wrong URL, and a marketing page behind the desktop gate turns every phone
 * visitor from search into a bounce.
 */

import { expect, test } from "@playwright/test";

import { watchCspViolations } from "./helpers";

/** Mirrors `PUBLIC_PAGES` in src/lib/seo.ts; a unit test pins that list to the device gate. */
const PUBLIC_PATHS = [
  "/",
  "/product",
  "/how-it-works",
  "/management-accounts",
  "/mis-report-format",
  "/tally-mis-report",
  "/for-accountants",
  "/ai-mis-report",
  "/mis-in-minutes",
  "/automated-management-accounts",
  "/monthly-financial-reporting",
  "/guides",
  "/guides/mis-kpis-and-ratios",
  "/guides/trial-balance-to-management-report",
  "/guides/debtors-ageing-report",
  "/guides/mis-commentary",
  "/guides/month-end-close-checklist",
  "/security",
  "/pricing",
  "/legal/terms",
  "/legal/privacy",
] as const;

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

test("every public page renders with a unique title, description and canonical", async ({
  page,
}) => {
  const titles = new Set<string>();
  for (const path of PUBLIC_PATHS) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);

    const title = await page.title();
    expect(title.length, `${path} has no title`).toBeGreaterThan(5);
    expect(titles.has(title), `${path} duplicates another page's title`).toBe(false);
    titles.add(title);

    const description = await page
      .locator('head meta[name="description"]')
      .getAttribute("content");
    expect(description?.length ?? 0, `${path} has no meta description`).toBeGreaterThan(
      50,
    );

    // A canonical is only useful if it points at this page. One pointing elsewhere is
    // worse than none: it tells a crawler the content lives at the other URL.
    const canonical = await page
      .locator('head link[rel="canonical"]')
      .getAttribute("href");
    expect(canonical ?? "", `${path} has no canonical`).toContain(
      path === "/" ? "" : path,
    );

    // Exactly one h1. Several, or none, is the most common on-page SEO defect there is.
    await expect(page.locator("h1"), path).toHaveCount(1);
  }
});

test("structured data survives the Content Security Policy and parses", async ({
  page,
}) => {
  // The policy has no `unsafe-inline`, and browsers apply script-src to a script element
  // whatever its type. Without the request nonce every one of these blocks is dropped and
  // no rich result ever appears -- with nothing logged anywhere to say so.
  const csp = watchCspViolations(page);

  for (const path of ["/", "/mis-report-format", "/security"]) {
    await page.goto(path);
    const blocks = await page
      .locator('script[type="application/ld+json"]')
      .allTextContents();
    expect(blocks.length, `${path} has no structured data`).toBeGreaterThan(0);

    for (const block of blocks) {
      const parsed = JSON.parse(block) as { "@context": string; "@type": string };
      expect(parsed["@context"]).toBe("https://schema.org");
      expect(parsed["@type"]).toBeTruthy();
    }

    // Read the IDL property, not the attribute: browsers blank the nonce *attribute*
    // after applying it, so getAttribute("nonce") is "" on a perfectly good element.
    const nonce = await page
      .locator('script[type="application/ld+json"]')
      .first()
      .evaluate((el) => (el as HTMLScriptElement).nonce);
    expect(nonce, `${path} structured data carries no nonce`).toBeTruthy();
  }

  expect(csp, csp.join("\n")).toEqual([]);
});

test("the FAQ answers a crawler is promised are the ones the reader can see", async ({
  page,
}) => {
  // A rich result offering an answer the page does not contain is a manual-action risk,
  // and wastes the click either way.
  await page.goto("/mis-report-format");
  const faqBlock = (
    await page.locator('script[type="application/ld+json"]').allTextContents()
  )
    .map((b) => JSON.parse(b) as { "@type": string; mainEntity?: { name: string }[] })
    .find((b) => b["@type"] === "FAQPage");
  expect(faqBlock?.mainEntity?.length ?? 0).toBeGreaterThan(2);

  for (const question of faqBlock?.mainEntity ?? []) {
    await expect(
      page.getByRole("group").filter({ hasText: question.name }).first(),
    ).toBeVisible();
  }
});

test("a visitor arriving from search on a phone gets the page, not the desktop gate", async ({
  browser,
}) => {
  // This bounce is the entire cost of ranking for a query, so it is asserted against the
  // real gate rather than trusted to the path list.
  const context = await browser.newContext({ userAgent: IPHONE });
  const page = await context.newPage();
  try {
    // The gate is a rewrite, not a redirect: the URL never changes, so asserting on the
    // URL would pass whether or not the reader got the gate. Assert on what they see.
    const GATE = "Please use a desktop computer";
    for (const path of PUBLIC_PATHS) {
      await page.goto(path);
      const heading = (await page.locator("h1").first().textContent()) ?? "";
      expect(heading, `${path} showed the desktop gate on a phone`).not.toContain(GATE);
      await expect(page.locator("h1"), path).toHaveCount(1);
    }
    // And the app itself is still gated, which is the other half of the rule.
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: GATE })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("robots.txt and sitemap.xml are served and agree with the site", async ({
  request,
}) => {
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  const robotsText = await robots.text();
  // The signed-in surface must not be indexed: an indexed /app URL is a stream of
  // visitors landing on a sign-in redirect.
  for (const disallowed of ["/app", "/api", "/wallet", "/settings"]) {
    expect(robotsText, `${disallowed} is not disallowed`).toContain(disallowed);
  }

  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const xml = await sitemap.text();
  for (const path of PUBLIC_PATHS) {
    if (path === "/") continue;
    expect(xml, `${path} is missing from the sitemap`).toContain(path);
  }
  // Nothing behind sign-in belongs in a sitemap, whatever robots.txt says.
  for (const secret of ["/app", "/wallet", "/settings", "/sign-in"]) {
    expect(xml, `${secret} is in the sitemap`).not.toContain(`<loc>${secret}`);
  }
});

test("public pages show no figure without saying it is fictional (SPEC §2.3)", async ({
  page,
}) => {
  // §2.3 permits marketing samples on fictional data only. The rule is only honoured if
  // the reader can tell, so a page that shows figures has to say so on the page.
  for (const path of ["/", "/product", "/mis-report-format"]) {
    await page.goto(path);
    const body = (await page.locator("body").textContent()) ?? "";
    expect(body, `${path} shows figures without a fictional-data note`).toMatch(
      /invented|fictional|illustration/iu,
    );
  }
});

test("the share card and favicon exist", async ({ page, request }) => {
  // A shared link with a blank rectangle is the first impression most people get.
  await page.goto("/");
  const ogImage = await page
    .locator('head meta[property="og:image"]')
    .first()
    .getAttribute("content");
  expect(ogImage, "no og:image").toBeTruthy();

  const image = await request.get(ogImage ?? "");
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toContain("image");

  const icon = await request.get("/icon");
  expect(icon.status()).toBe(200);
});
