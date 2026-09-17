/**
 * ADR 0031 browser acceptance: a run gets to a workbook from what people actually upload.
 *
 * A trial balance exported from a system other than Tally, as CSV, naming no month; a notes
 * file alongside it; and a photo. The photo is turned away with what to export instead, the
 * notes are set aside rather than failing the job, the month is asked for once, and the
 * workbook is delivered.
 */

import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { createVerifiedAccount, uniqueEmail, watchCspViolations } from "./helpers";

// The local Supabase stack's database (supabase/config.toml defaults; not a secret).
const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

let page: Page;
let csp: string[] = [];
let db: pg.Pool;

test.beforeAll(async ({ browser }) => {
  db = new pg.Pool({ connectionString: LOCAL_DB, max: 2 });
  page = await browser.newPage();
  csp = watchCspViolations(page);
  const email = uniqueEmail();
  await createVerifiedAccount(page, email);
  const consent = await page.request.post("/api/account/consents", {
    data: { document: "processing" },
    headers: { "idempotency-key": randomUUID() },
  });
  expect(consent.ok()).toBe(true);
  const account = await db.query<{ id: string }>(
    `select id from accounts where email = $1`,
    [email],
  );
  const { grantCredits } = await import("@magicmis/wallet");
  await grantCredits(db, {
    accountId: account.rows[0]?.id ?? "",
    credits: 20_000n,
    source: "admin_grant",
    idempotencyKey: randomUUID(),
  });
});

test.afterAll(async () => {
  await page.close();
  await db.end();
});

test("a non-Tally CSV with no month, a notes file and a photo still produce a workbook", async () => {
  await page.goto("/app");
  await page.getByLabel("Company name").fill("Frictionless Exports Ltd");
  await page.getByRole("button", { name: "Add company" }).click();
  await expect(page).toHaveURL(/\/app\/companies\/[0-9a-f-]+\/run$/u);
  await expect(page.getByLabel("Choose files")).toBeEnabled();

  await page.getByLabel("Choose files").setInputFiles([
    {
      name: "export.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "Account,Debit,Credit\nCash at bank,1500,\nSales,,2500\nRent,1000,\n",
      ),
    },
    {
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Things to discuss\nNew office lease\n"),
    },
    {
      name: "scan.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    },
  ]);
  await expect(page.getByTestId("job-skipped")).toContainText("scan.jpg");
  await expect(page.getByTestId("job-files").getByRole("row")).toHaveCount(3);

  await expect(page.getByTestId("job-price")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /^Run setup —/u }).click();

  // The one question: which month, pre-filled with a sensible guess.
  const question = page.getByTestId("job-period");
  await expect(question).toBeVisible({ timeout: 120_000 });
  await expect(page.getByLabel("Month for export.csv")).toHaveValue(/^\d{4}-\d{2}$/u);
  await page.getByLabel("Month for export.csv").fill("2026-03");
  await question.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("button", { name: "Confirm mappings" })).toBeVisible({
    timeout: 120_000,
  });
  const accept = page.getByRole("button", { name: "Accept remaining as proposed" });
  if (await accept.isVisible()) await accept.click();
  await page.getByRole("button", { name: "Confirm mappings" }).click();

  await expect(page.getByTestId("job-done")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId("job-download")).toBeVisible();
  await expect(page.getByTestId("job-notices")).toContainText("left out");
  expect(csp).toEqual([]);
});

test("a profit and loss with no sides is used as a best guess rather than refused", async () => {
  await page.goto("/app");
  await page.getByLabel("Company name").fill("Best Guess Traders");
  await page.getByRole("button", { name: "Add company" }).click();
  await expect(page.getByLabel("Choose files")).toBeEnabled();

  await page.getByLabel("Choose files").setInputFiles({
    name: "Profit and loss March 2026.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Particulars,Amount\nSales,5000\nRent,2000\nNet Profit,3000\n"),
  });
  await expect(page.getByTestId("job-price")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /^Run setup —/u }).click();

  // Everything mapped from the library, so review offers a one-click continue.
  const proceed = page.getByRole("button", {
    name: /^(Confirm mappings|Looks right — continue)$/u,
  });
  await expect(proceed).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("job-notices")).toContainText("looked most like");
  await proceed.click();

  await expect(page.getByTestId("job-done")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId("job-download")).toBeVisible();
  expect(csp).toEqual([]);
});
