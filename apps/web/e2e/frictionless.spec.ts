/**
 * ADR 0031 and 0032 browser acceptance: a run gets to a workbook from what people actually
 * upload, with the server doing the work and nothing stopping to ask.
 *
 * A trial balance exported from a system other than Tally, as CSV, naming no month; a notes
 * file alongside it; and a photo. The photo is turned away with what to export instead, the
 * notes are set aside, the month is assumed and said, and the workbook is delivered.
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

async function newCompany(name: string) {
  await page.goto("/app");
  // The form is there whether or not this account already has companies (ADR 0061).
  await page.getByLabel("Company name").fill(name);
  await page.getByRole("button", { name: "Add company" }).click();
  // A new company is set up from its own workspace (ADR 0033).
  await expect(page).toHaveURL(/\/app\/companies\/[0-9a-f-]+$/u);
  await expect(page.getByLabel("Choose files")).toBeEnabled();
}

test("a non-Tally CSV with no month, a notes file and a photo still produce a workbook", async () => {
  await newCompany("Frictionless Exports Ltd");
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
  await expect(page.getByTestId("job-files").getByRole("row")).toHaveCount(4);
  await expect(page.getByTestId("job-file-problem")).toContainText("photo or scan", {
    timeout: 60_000,
  });

  // One button starts the run; there is no price step (ADR 0033).
  await expect(page.getByTestId("job-run")).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId("job-run").click();

  // No review and no questions: the server runs it through.
  await expect(page.getByTestId("job-done")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId("job-download")).toBeVisible();
  const notices = page.getByTestId("job-notices");
  await expect(notices).toContainText("left out");
  await expect(notices).toContainText("doesn't say which month");
  expect(csp).toEqual([]);
});

test("a profit and loss with no sides is used as a best guess rather than refused", async () => {
  await newCompany("Best Guess Traders");
  await page.getByLabel("Choose files").setInputFiles({
    name: "Profit and loss March 2026.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Particulars,Amount\nSales,5000\nRent,2000\nNet Profit,3000\n"),
  });
  // One button starts the run; there is no price step (ADR 0033).
  await expect(page.getByTestId("job-run")).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId("job-run").click();

  await expect(page.getByTestId("job-done")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId("job-download")).toBeVisible();
  await expect(page.getByTestId("job-notices")).toContainText("looked most like");
  expect(csp).toEqual([]);
});

test("uploaded files are stored encrypted: nothing readable reaches the store", async () => {
  const rows = await db.query<{ n: number }>(
    `select count(*)::int as n from source_uploads where status = 'ready'`,
  );
  expect(rows.rows[0]?.n).toBeGreaterThan(0);
  const { readdir, readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const root = path.join(process.cwd(), ".data", "outputs");
  const walk = async (dir: string): Promise<string[]> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const out: string[] = [];
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...(await walk(p)));
      else if (p.includes(`${path.sep}sources${path.sep}`)) out.push(p);
    }
    return out;
  };
  const stored = await walk(root);
  expect(stored.length).toBeGreaterThan(0);
  for (const f of stored)
    expect((await readFile(f)).includes(Buffer.from("Cash at bank"))).toBe(false);
});
