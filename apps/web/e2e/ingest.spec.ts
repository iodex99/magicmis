/**
 * Phase 3 browser acceptance (SPEC §15, §17, §33, §34): files are parsed in a Web Worker and
 * loaded into DuckDB-WASM; before payment only names, sizes, sheet counts and row counts are
 * shown; session data clears; the payload inspector shows redacted JSON in developer mode;
 * a 50 MB workbook loads in under 60 seconds.
 */

import { statSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { FIXTURES_OUT } from "./fixtures-setup";
import {
  createVerifiedAccountWithTotp,
  uniqueEmail,
  watchCspViolations,
} from "./helpers";

const fixture = (...parts: string[]) => path.join(FIXTURES_OUT, ...parts);

// One account for the whole file: sign-ups are rate-limited by the local Auth server.
test.describe.configure({ mode: "serial" });
let page: Page;
let csp: string[] = [];

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  csp = watchCspViolations(page);
  await createVerifiedAccountWithTotp(page, uniqueEmail());
  // SPEC §31: the first upload in an account waits for the processing notice to be accepted.
  await page.goto("/app/data");
  await expect(page.getByTestId("processing-notice")).toBeVisible();
  await expect(page.getByLabel(/Excel or CSV exports/u)).toHaveCount(0);
  await page.getByRole("button", { name: /I understand/u }).click();
  await expect(page.getByLabel(/Excel or CSV exports/u)).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel(/Excel or CSV exports/u)).toBeEnabled();
  await expect(page.getByTestId("processing-notice")).toHaveCount(0);
});

test.afterAll(async () => {
  await page.close();
});

async function openData() {
  await page.goto("/app/data");
  await expect(page.getByLabel(/Excel or CSV exports/u)).toBeEnabled();
  if (await page.getByTestId("loaded-files").isVisible()) {
    await page.getByRole("button", { name: "Clear session data" }).click();
    await expect(page.getByText("No files loaded.")).toBeVisible();
  }
}

test("files load in the browser and only names, sizes, sheets and rows are shown before payment", async () => {
  await openData();
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") requests.push(`${r.method()} ${r.url()}`);
  });

  const tb = fixture("trading", "clean", "trial_balance_2025-04.xlsx");
  const register = fixture("trading", "clean", "sales_register_2025-04.csv");
  await page.getByLabel(/Excel or CSV exports/u).setInputFiles([tb, register]);

  const table = page.getByTestId("loaded-files");
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(table).toContainText("trial_balance_2025-04.xlsx");
  await expect(table).toContainText("sales_register_2025-04.csv");
  await expect(table.getByRole("row", { name: /trial_balance/u })).toContainText(
    `${(statSync(tb).size / 1024).toFixed(0)} KB`,
  );

  // SPEC §2.3: no recognition results before payment.
  const body = page.locator("main");
  for (const leak of [
    "Trial Balance",
    "Sales Register",
    "Sundry Debtors",
    "Northwind",
    "Synthetic Hardware",
  ]) {
    await expect(body).not.toContainText(leak);
  }
  // Raw files never leave the browser: no request carried a body while loading.
  expect(requests.filter((r) => !r.includes("/_next/"))).toEqual([]);

  await page.getByRole("button", { name: "Clear session data" }).click();
  await expect(page.getByText("No files loaded.")).toBeVisible();
});

test("unsupported files are refused with a clear message", async () => {
  await openData();
  await page.getByLabel(/Excel or CSV exports/u).setInputFiles({
    name: "notes.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4"),
  });
  await expect(page.getByTestId("ingest-progress")).toContainText(
    "Only .xlsx, .xlsm, .xls and .csv files are accepted.",
  );
});

test("payload inspector shows redacted JSON in developer mode", async () => {
  test.skip(
    process.env["NEXT_PUBLIC_ENVIRONMENT"] === "production",
    "developer mode only",
  );
  await openData();
  await page
    .getByLabel(/Excel or CSV exports/u)
    .setInputFiles([
      fixture("trading", "clean", "trial_balance_2025-06.xlsx"),
      fixture("trading", "clean", "bills_payable_2025-06.csv"),
    ]);
  await expect(page.getByTestId("loaded-files").getByRole("row")).toHaveCount(3);
  const bills = page
    .getByTestId("loaded-files")
    .getByRole("row", { name: /bills_payable/u });
  await bills.getByRole("button", { name: "Inspect payload" }).click();
  const inspector = page.getByTestId("payload-inspector");
  await expect(inspector).toContainText('"reportType": "bills_payable"');
  await expect(inspector).toContainText("PARTY_");
  for (const name of [
    "Greenfield Metals",
    "Harbor Logistics",
    "Foundry Supply Co",
    "Synthetic Hardware Traders",
  ]) {
    await expect(inspector).not.toContainText(name);
  }
});

test("a 50 MB workbook is parsed and loaded into DuckDB in under 60 seconds (SPEC §33)", async () => {
  test.setTimeout(240_000);
  const large = fixture("perf", "large-day-book.xlsx");
  expect(statSync(large).size).toBeGreaterThan(49 * 1024 * 1024);
  await openData();

  const started = Date.now();
  await page.getByLabel(/Excel or CSV exports/u).setInputFiles(large);
  await expect(page.getByTestId("loaded-files")).toContainText("large-day-book.xlsx", {
    timeout: 90_000,
  });
  const elapsed = Date.now() - started;
  console.warn(`50 MB workbook loaded in ${(elapsed / 1000).toFixed(1)} s`);
  await expect(page.getByTestId("loaded-files")).toContainText("3,70,004");
  expect(elapsed).toBeLessThan(60_000);
});

test("pages carry a per-request nonce CSP and hardening headers (SPEC §30)", async () => {
  const first = await page.request.get("/app/data");
  const second = await page.request.get("/app/data");
  const policy = first.headers()["content-security-policy"] ?? "";
  expect(policy).toMatch(/script-src [^;]*'nonce-[A-Za-z0-9+/=]+'/u);
  expect(policy).not.toContain("razorpay");
  expect(policy).not.toBe(second.headers()["content-security-policy"]);
  expect(first.headers()["x-frame-options"]).toBe("DENY");
  expect(first.headers()["x-content-type-options"]).toBe("nosniff");
  const wallet = await page.request.get("/wallet");
  expect(wallet.headers()["content-security-policy"]).toContain(
    "frame-src https://*.razorpay.com",
  );
});

test("no Content Security Policy violations anywhere in the flow (SPEC §30)", () => {
  expect(csp).toEqual([]);
});
