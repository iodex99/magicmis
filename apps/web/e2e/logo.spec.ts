/**
 * A company's own logo: chosen while adding the company or later on Files and settings, judged by
 * its bytes rather than its name, sealed under the company's key, served only to its owner, and
 * shown beside the name on the company list and the company's header. (Present is checked in
 * mis.spec.ts, where a company has a built dashboard to present.)
 */

import { expect, test, type Page } from "@playwright/test";

import {
  createVerifiedAccount,
  TINY_PNG,
  uniqueEmail,
  watchCspViolations,
} from "./helpers";

// One account for the whole file: sign-ups are rate-limited by the local Auth server.
test.describe.configure({ mode: "serial" });
let page: Page;
let csp: string[] = [];
let companyId = "";

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  csp = watchCspViolations(page);
  await createVerifiedAccount(page, uniqueEmail());
});

test.afterAll(async () => {
  expect(csp).toEqual([]);
  await page.close();
});

const logoImage = (scope: Page | ReturnType<Page["locator"]>) =>
  scope.getByTestId("company-logo").locator("img");

async function drawn(img: ReturnType<Page["locator"]>): Promise<number> {
  return img.evaluate((el) => (el as HTMLImageElement).naturalWidth);
}

test("a logo chosen while adding the company is on its header and the company list", async () => {
  await page.goto("/app");
  await page.getByLabel("Company name").fill("Logo Test Traders");
  // A disguised SVG is refused before anything is sent, whatever it is called.
  await page.getByLabel(/Logo/u).setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>',
    ),
  });
  await expect(page.getByTestId("logo-picker").getByRole("alert")).toContainText(
    "JPG, PNG or WebP",
  );
  await page.getByLabel(/Logo/u).setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: TINY_PNG,
  });
  await expect(page.getByTestId("logo-picker").getByTestId("company-logo")).toBeVisible();
  await page.getByRole("button", { name: "Add company" }).click();
  await expect(page).toHaveURL(/\/app\/companies\/[0-9a-f-]+$/u);
  companyId = /\/app\/companies\/([0-9a-f-]+)/u.exec(page.url())?.[1] ?? "";

  const header = logoImage(page.locator("header"));
  await expect(header).toBeVisible();
  expect(await drawn(header)).toBeGreaterThan(0);

  await page.goto("/app");
  const card = logoImage(page.getByTestId("company-list"));
  await expect(card).toBeVisible();
  expect(await drawn(card)).toBeGreaterThan(0);
});

test("it is served sealed-then-opened to its owner only, as the type its bytes are", async ({
  browser,
}) => {
  const src = await logoImage(page.getByTestId("company-list")).getAttribute("src");
  expect(src).toMatch(/^\/api\/companies\/[0-9a-f-]+\/logo\?v=[0-9a-f-]+$/u);
  const own = await page.request.get(src ?? "");
  expect(own.status()).toBe(200);
  expect(own.headers()["content-type"]).toBe("image/png");
  expect(own.headers()["x-content-type-options"]).toBe("nosniff");
  expect(own.headers()["cache-control"]).toContain("immutable");
  expect(Buffer.from(await own.body()).equals(TINY_PNG)).toBe(true);

  // Somebody who is not signed in gets nothing.
  const stranger = await browser.newContext();
  const theirs = await stranger.request.get(src ?? "");
  expect(theirs.status()).toBe(401);
  await stranger.close();
});

test("on Files and settings it is refused when wrong, replaced and taken off", async () => {
  await page.goto(`/app/companies/${companyId}/manage`);
  const settings = page.getByTestId("logo-settings");
  await expect(logoImage(settings)).toBeVisible();

  // Over a megabyte is refused by the server too, not only the browser.
  const big = Buffer.alloc(1_048_577);
  TINY_PNG.copy(big);
  const tooBig = await page.request.put(`/api/companies/${companyId}/logo`, {
    headers: { "content-type": "application/octet-stream" },
    data: big,
  });
  expect(tooBig.status()).toBe(413);
  expect((await tooBig.json()) as { error: string }).toMatchObject({
    error: "logo_too_large",
  });

  const before = await logoImage(settings).getAttribute("src");
  await page.getByTestId("logo-input").setInputFiles({
    name: "new.png",
    mimeType: "image/png",
    buffer: TINY_PNG,
  });
  await expect(settings).toContainText("Logo saved");
  await expect(logoImage(settings)).not.toHaveAttribute("src", before ?? "");

  await settings.getByRole("button", { name: "Remove" }).click();
  await expect(settings).toContainText("Logo removed");
  await expect(settings.getByTestId("company-logo")).toHaveCount(0);
  await page.goto(`/app/companies/${companyId}`);
  await expect(page.locator("header").getByTestId("company-logo")).toHaveCount(0);
});
