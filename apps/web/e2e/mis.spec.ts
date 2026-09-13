/**
 * Phase 6 browser acceptance (SPEC §23, §24.1, §34): a company is set up from 13 monthly trial
 * balances and then refreshed with the next month, entirely through the UI. Files are processed
 * in the pipeline worker; the server holds, captures and stores. The refresh on a matching file
 * skips review and makes zero AI calls. The workbook downloads and opens.
 */

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import * as XLSX from "xlsx";

import { FIXTURES_OUT } from "./fixtures-setup";
import { createVerifiedAccountWithTotp, uniqueEmail } from "./helpers";

// The local Supabase stack's database (supabase/config.toml defaults; not a secret).
const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

let page: Page;
let db: pg.Pool;
let email: string;

const tb = (month: string) =>
  path.join(FIXTURES_OUT, "trading", "clean", `trial_balance_${month}.xlsx`);
const SETUP_MONTHS = [
  "2025-04",
  "2025-05",
  "2025-06",
  "2025-07",
  "2025-08",
  "2025-09",
  "2025-10",
  "2025-11",
  "2025-12",
  "2026-01",
  "2026-02",
  "2026-03",
  "2026-04",
];

test.beforeAll(async ({ browser }) => {
  db = new pg.Pool({ connectionString: LOCAL_DB, max: 2 });
  page = await browser.newPage();
  email = uniqueEmail();
  await createVerifiedAccountWithTotp(page, email);
  // Fund the wallet the way an admin grant would (Razorpay needs live test keys; ADR 0012).
  const account = await db.query<{ id: string }>(
    `select id from accounts where email = $1`,
    [email],
  );
  const accountId = account.rows[0]?.id ?? "";
  const { grantCredits } = await import("@magicmis/wallet");
  await grantCredits(db, {
    accountId,
    credits: 20_000n,
    source: "admin_grant",
    idempotencyKey: randomUUID(),
  });
});

test.afterAll(async () => {
  await page.close();
  await db.end();
});

async function aiCallsForAccount(): Promise<number> {
  const r = await db.query<{ n: number }>(
    `select count(*)::int as n from ai_calls c join accounts a on a.id = c.account_id where a.email = $1`,
    [email],
  );
  return r.rows[0]?.n ?? -1;
}

async function runJob(files: string[], expectReview: boolean) {
  await page.getByLabel("Choose files").setInputFiles(files);
  await expect(page.getByTestId("job-files").getByRole("row")).toHaveCount(
    files.length + 1,
  );
  // SPEC §2.3: before the price is confirmed, no recognition results.
  await expect(page.locator("main")).not.toContainText(
    /Sundry Debtors|Northwind|Revenue/u,
  );
  await page.getByRole("button", { name: "Get price" }).click();
  await expect(page.getByTestId("job-price")).toBeVisible();
  await page.getByRole("button", { name: /Confirm —/u }).click();
  if (expectReview) {
    await expect(page.getByRole("button", { name: "Confirm mappings" })).toBeVisible({
      timeout: 120_000,
    });
    const accept = page.getByRole("button", { name: "Accept remaining as proposed" });
    if (await accept.isVisible()) await accept.click();
    await page.getByRole("button", { name: "Confirm mappings" }).click();
  }
  await expect(page.getByTestId("job-done")).toBeVisible({ timeout: 180_000 });
}

test("sets up a company from thirteen months of trial balances", async () => {
  await page.goto("/app");
  await page.getByLabel("Company name").fill("Synthetic Hardware Traders");
  await page.getByRole("button", { name: "Add company" }).click();
  await expect(page).toHaveURL(/\/app\/companies\/[0-9a-f-]+\/run$/u);
  await expect(page.getByLabel("Choose files")).toBeEnabled();

  await runJob(SETUP_MONTHS.map(tb), true);
  await expect(page.getByTestId("job-checks")).toContainText("V11");
  await expect(page.getByTestId("job-done")).toContainText("999 credits charged");

  const download = page.waitForEvent("download");
  await page.getByTestId("job-download").click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(
    /^Synthetic_Hardware_Traders_Monthly_Financial_MIS_2026-04_v1\.xlsx$/u,
  );
  const workbook = XLSX.read(await readFile(await file.path()), { type: "buffer" });
  expect(workbook.SheetNames).toEqual([
    "Cover",
    "Index",
    "P&L",
    "Ratios",
    "Balance sheet",
    "Checks",
    "Data",
    "Lineage",
  ]);
  // Names are rehydrated in the browser; the Data sheet shows real party names from this session.
  expect(
    JSON.stringify(XLSX.utils.sheet_to_json(workbook.Sheets["Data"] ?? {})),
  ).toContain("Northwind");
});

test("refreshes the next month with no review and zero AI calls", async () => {
  await page.goto("/app");
  await page.getByRole("link", { name: "Refresh" }).click();
  await expect(page.getByLabel("Choose files")).toBeEnabled();
  await runJob([tb("2026-05")], false);
  await expect(page.getByTestId("job-done")).toContainText("299 credits charged");

  expect(await aiCallsForAccount()).toBe(0);
  const r = await db.query<{ type: string; state: string; captured_credits: string }>(
    `select j.type, j.state, j.captured_credits::text from jobs j join accounts a on a.id = j.account_id where a.email = $1 order by j.created_at`,
    [email],
  );
  expect(r.rows).toEqual([
    { type: "company_setup", state: "completed", captured_credits: "999" },
    { type: "monthly_refresh", state: "completed", captured_credits: "299" },
  ]);
  const wallet = await db.query<{ balance_credits: string; held_credits: string }>(
    `select w.balance_credits::text, w.held_credits::text from wallets w join accounts a on a.id = w.account_id where a.email = $1`,
    [email],
  );
  expect(wallet.rows[0]).toEqual({
    balance_credits: (20_000 - 999 - 299).toString(),
    held_credits: "0",
  });
});
