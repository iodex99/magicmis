/**
 * ADR 0031 and 0032 browser acceptance: a run gets to a workbook from what people actually
 * upload, with the server doing the work and nothing stopping to ask.
 *
 * A trial balance exported from a system other than Tally, as CSV, naming no month; a notes
 * file alongside it; and a photo. The photo is turned away with what to export instead, the
 * notes are set aside, the month is assumed and said, and the workbook is delivered.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { FIXTURES_OUT } from "./fixtures-setup";
import { createVerifiedAccount, uniqueEmail, watchCspViolations } from "./helpers";

// The local Supabase stack's database (supabase/config.toml defaults; not a secret).
const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

let page: Page;
let csp: string[] = [];
let db: pg.Pool;
let accountId = "";

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
  accountId = account.rows[0]?.id ?? "";
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

async function newCompany(name: string) {
  await page.goto("/app");
  // The form is there whether or not this account already has companies (ADR 0061).
  await page.getByLabel("Company name").fill(name);
  await page.getByRole("button", { name: "Add company" }).click();
  // A new company is set up from its own workspace (ADR 0033).
  await expect(page).toHaveURL(/\/app\/companies\/[0-9a-f-]+$/u);
  await expect(page.getByLabel("Choose files")).toBeEnabled();
}

test("before the first company, a finished sample is one link away and reading it charges nothing (ADR 0086)", async () => {
  await page.goto("/app");
  await page.getByTestId("sample-link").click();
  await expect(page).toHaveURL(/\/app\/sample$/u);
  await expect(page.getByTestId("sample-note")).toContainText("invented");

  // It reads as a company's own board does: a figure opens the ledgers behind it, and the
  // board can be read over another range and presented.
  const board = page.getByTestId("sample-board");
  await expect(board.getByTestId("dashboard-grid")).toBeVisible();
  await board.locator("[data-metric-key]").first().click();
  await expect(page.getByTestId("lineage-panel")).toBeVisible();
  await page.getByTestId("lineage-panel").getByRole("button", { name: "Close" }).click();
  await board.getByTestId("range-filter").selectOption("n12");
  await board.getByTestId("present").click();
  await expect(board.getByTestId("stage")).toHaveAttribute("data-presenting", "true");
  await board.getByTestId("present-exit").click();

  // Nothing on it edits, charges or opens a chat: it belongs to no company.
  await expect(board.getByTestId("box-actions")).toHaveCount(0);
  await expect(board.getByTestId("where-to-act")).toHaveCount(0);
  await expect(board.getByTestId("dashboard-files")).toHaveCount(0);
  await expect(board.getByRole("button", { name: "Edit layout" })).toHaveCount(0);

  // Where to act and the commentary, as the assistant writes them, every figure filled in.
  await expect(page.getByTestId("board-actions")).toContainText(
    "Not tax, legal or audit advice",
  );
  await page.getByRole("radio", { name: "Commentary" }).click();
  await expect(page.getByTestId("commentary")).toBeVisible();
  await expect(page.getByTestId("commentary")).not.toContainText("{{");

  const work = await db.query<{ jobs: number; messages: number; calls: number }>(
    `select (select count(*)::int from jobs where account_id = $1) as jobs,
            (select count(*)::int from chat_messages where account_id = $1) as messages,
            (select count(*)::int from ai_calls where account_id = $1) as calls`,
    [accountId],
  );
  expect(work.rows[0]).toEqual({ jobs: 0, messages: 0, calls: 0 });
  expect(csp).toEqual([]);
});

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

test("files on another financial year stop the run to ask, and either answer carries it on without a second charge (ADR 0086)", async () => {
  // The trading books run April to March and their profit-and-loss balances reset each April;
  // a company set to a calendar year would read April as the whole year with a minus sign.
  const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"];
  const books = months.map((m) =>
    path.join(FIXTURES_OUT, "trading", "clean", `trial_balance_${m}.xlsx`),
  );
  const calendarYear = async (name: string) => {
    await newCompany(name);
    const id = page.url().split("/").pop() ?? "";
    const c = await db.query<{
      currency: string;
      number_format: string;
      date_order: string;
    }>(`select currency, number_format, date_order from companies where id = $1`, [id]);
    const row = c.rows[0];
    const set = await page.request.patch(`/api/companies/${id}`, {
      data: {
        fyStartMonth: 1,
        currency: row?.currency,
        numberFormat: row?.number_format,
        dateOrder: row?.date_order,
      },
      headers: { "idempotency-key": randomUUID() },
    });
    expect(set.ok()).toBe(true);
    await page.reload();
    await page.getByLabel("Choose files").setInputFiles(books);
    await page.getByTestId("job-run").click({ timeout: 120_000 });
    const question = page.getByTestId("job-year");
    await expect(question).toContainText("starts in April", { timeout: 120_000 });
    await expect(question).toContainText("in January");
    const job = await db.query<{ id: string; state: string; captured: string | null }>(
      `select id, state, captured_credits::text as captured from jobs where company_id = $1`,
      [id],
    );
    // Waiting, with its credits held and nothing taken.
    expect(job.rows).toHaveLength(1);
    expect(job.rows[0]?.state).toBe("awaiting_review");
    expect(job.rows[0]?.captured ?? "0").toBe("0");
    return { id, jobId: job.rows[0]?.id ?? "" };
  };
  const settled = async (companyId: string) =>
    (
      await db.query<{ n: number; captured: string; fy: number }>(
        `select count(*)::int as n, max(j.captured_credits)::text as captured,
                max(c.fy_start_month) as fy
           from jobs j join companies c on c.id = j.company_id
          where j.company_id = $1 and j.type = 'company_setup'`,
        [companyId],
      )
    ).rows[0];

  // Use the files' year: the owner's change to the company, then the same run carries on.
  const first = await calendarYear("Calendar Year Traders");
  await page.getByTestId("job-year-files").click();
  await expect(page.getByTestId("job-done")).toContainText("credits charged", {
    timeout: 180_000,
  });
  const one = await settled(first.id);
  expect(one?.n).toBe(1);
  expect(one?.fy).toBe(4);
  expect(BigInt(one?.captured ?? "0")).toBeGreaterThan(0n);

  // Keep the company's year, answered from the email's link: still one run, one charge, and
  // the workbook says what keeping it means.
  const second = await calendarYear("Calendar Year Keepers");
  await page.goto(`/app/jobs/${second.jobId}`);
  await expect(page).toHaveURL(new RegExp(`/run\\?job=${second.jobId}$`, "u"));
  await page.getByTestId("job-year-keep").click();
  await expect(page.getByTestId("job-done")).toContainText("credits charged", {
    timeout: 180_000,
  });
  await expect(page.getByTestId("job-notices")).toContainText(
    "kept on a year starting in January",
  );
  const two = await settled(second.id);
  expect(two?.n).toBe(1);
  expect(two?.fy).toBe(1);
  expect(BigInt(two?.captured ?? "0")).toBeGreaterThan(0n);
  expect(csp).toEqual([]);
});
