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
import { createVerifiedAccountWithTotp, uniqueEmail, watchCspViolations } from "./helpers";

// The local Supabase stack's database (supabase/config.toml defaults; not a secret).
const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

let page: Page;
let csp: string[] = [];
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
  csp = watchCspViolations(page);
  email = uniqueEmail();
  await createVerifiedAccountWithTotp(page, email);
  const consent = await page.request.post("/api/account/consents", {
    data: { document: "processing" },
  });
  expect(consent.ok()).toBe(true);
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

test("adds the dashboard, opens lineage from a number, edits with preview, and undoes", async () => {
  const company = await db.query<{ id: string }>(
    `select c.id from companies c join accounts a on a.id = c.account_id where a.email = $1`,
    [email],
  );
  const companyId = company.rows[0]?.id ?? "";
  await page.goto(`/app/companies/${companyId}`);
  await page.getByRole("link", { name: "Dashboard" }).click();
  await page.getByRole("button", { name: "Get price" }).click();
  await expect(page.getByTestId("job-price")).toContainText("Dashboard");
  await page.getByRole("button", { name: /^Confirm/u }).click();

  const revenue = page.getByTestId("widget-kpi_revenue");
  await expect(revenue).toBeVisible();
  await expect(page.getByTestId("period-filter")).toHaveValue("2026-05");
  await revenue.locator("[data-metric-key='revenue@2026-05']").click();
  await expect(page.getByTestId("lineage-panel")).toContainText("revenue");
  await expect(page.getByTestId("lineage-panel")).toContainText("Formula");

  await page.getByRole("button", { name: "Edit layout" }).click();
  page.once("dialog", (d) => void d.accept("Sales"));
  await revenue.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByTestId("patch-preview")).toContainText("1 change");
  await expect(revenue).toContainText("Sales");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByTestId("patch-preview")).toHaveCount(0);
  await expect(revenue).toContainText("Sales");

  await page.getByRole("button", { name: "Undo last change" }).click();
  await expect(revenue).toContainText("Revenue");
  await expect(page.getByRole("button", { name: "Undo last change" })).toHaveCount(0);

  const versions = await db.query<{ n: number }>(
    `select count(*)::int as n from blueprints where company_id = $1`,
    [companyId],
  );
  // v1 setup, v2 dashboard add-on, v3 rename, v4 undo.
  expect(versions.rows[0]?.n).toBe(4);
  expect(await aiCallsForAccount()).toBe(0);
});

test("sets up a company that recreates the user's reference MIS, with binding review and no AI call", async () => {
  const { referenceMisWorkbook } = await import("@magicmis/fixtures");
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(path.join(tmpdir(), "reference-mis-"));
  const referencePath = path.join(dir, "Client_MIS.xlsx");
  await writeFile(referencePath, await referenceMisWorkbook({ rulesOnly: true }));

  await page.goto("/app");
  await page.getByLabel("Company name").fill("Synthetic Recreated Traders");
  await page.getByRole("button", { name: "Add company" }).click();
  await expect(page.getByLabel("Choose files")).toBeEnabled();
  await page.getByLabel("Choose files").setInputFiles(SETUP_MONTHS.map(tb));
  await page.getByLabel("Choose reference MIS").setInputFiles(referencePath);
  await expect(page.getByTestId("job-reference")).toContainText("2 sheets");
  // Before payment, nothing from the reference's rows is shown.
  await expect(page.locator("main")).not.toContainText(/Sundry Debtors|Net Profit/u);

  await page.getByRole("button", { name: "Get price" }).click();
  await expect(page.getByTestId("job-price")).toContainText("1,498");
  await page.getByRole("button", { name: /Confirm —/u }).click();

  await expect(page.getByRole("button", { name: "Confirm mappings" })).toBeVisible({
    timeout: 120_000,
  });
  const accept = page.getByRole("button", { name: "Accept remaining as proposed" });
  if (await accept.isVisible()) await accept.click();
  await page.getByRole("button", { name: "Confirm mappings" }).click();

  const review = page.getByTestId("binding-review");
  await expect(review).toBeVisible();
  await expect(review).toContainText("Total Income");
  // The user decides one row has no source in these files.
  await page
    .getByLabel("What Interest shows")
    .selectOption({ label: "Not available from supplied data" });
  await page.getByRole("button", { name: "Confirm rows" }).click();
  await expect(page.getByTestId("job-done")).toContainText("1,498 credits charged", {
    timeout: 180_000,
  });

  await expect(page.getByTestId("job-checks")).toContainText("V11");
  const download = page.waitForEvent("download");
  await page.getByTestId("job-download").click();
  const workbook = XLSX.read(await readFile(await (await download).path()), {
    type: "buffer",
  });
  expect(workbook.SheetNames).toEqual([
    "Cover",
    "Index",
    "P&L Summary",
    "Working Capital",
    "Checks",
    "Data",
    "Lineage",
  ]);
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(
    workbook.Sheets["P&L Summary"] ?? {},
    { header: 1 },
  );
  const interest = rows.find((r) => r[0] === "Interest");
  expect(interest?.[1]).toBe("Not available from supplied data");
  const totalIncome = rows.find((r) => r[0] === "Total Income");
  expect(typeof totalIncome?.[1]).toBe("number");

  const job = await db.query<{ type: string; state: string }>(
    `select j.type, j.state from jobs j join companies c on c.id = j.company_id join accounts a on a.id = c.account_id
     where c.name = 'Synthetic Recreated Traders' and a.email = $1`,
    [email],
  );
  expect(job.rows).toEqual([{ type: "reference_mis_recreate", state: "completed" }]);
  expect(await aiCallsForAccount()).toBe(0);
});

test.describe("chat with the MIS", () => {
  const CHAT_STAGES = ["chat_quick", "chat_deep", "chat_edit", "thread_summary"];
  let activated: string[] = [];

  test.beforeAll(async () => {
    // The local stack has no prompt activated (R-28); these tests drive the fake model.
    const r = await db.query<{ id: string }>(
      `update tier_routing set prompt_version = 1 where stage = any($1) and prompt_version is null returning id`,
      [CHAT_STAGES],
    );
    activated = r.rows.map((x) => x.id);
  });
  test.afterAll(async () => {
    await db.query(`update tier_routing set prompt_version = null where id = any($1)`, [activated]);
  });

  const companyId = async () => {
    const r = await db.query<{ id: string }>(
      `select c.id from companies c join accounts a on a.id = c.account_id where a.email = $1 and c.name = 'Synthetic Hardware Traders'`,
      [email],
    );
    return r.rows[0]?.id ?? "";
  };

  test("quick answers resolve placeholders with lineage; out-of-scope is declined and charged", async () => {
    await page.goto(`/app/companies/${await companyId()}/chat`);
    await expect(page.getByTestId("chat-send")).toContainText("19 credits");
    await expect(page.getByText("including questions outside this MIS")).toBeVisible();
    await page.getByLabel("Your question").fill("How did revenue move this month?");
    await page.getByTestId("chat-send").click();
    const answer = page.getByTestId("chat-answer").last();
    await expect(answer).toContainText("The figure you asked about is");
    await answer.locator("[data-lineage^='revenue']").first().click();
    await expect(page.getByTestId("lineage-panel")).toContainText("Formula");

    await page.getByLabel("Your question").fill("Write me a poem about the sea.");
    await page.getByTestId("chat-send").click();
    await expect(page.getByTestId("chat-user").last()).toContainText("outside this MIS · 19 credits");
    const states = await db.query<{ state: string; credits_charged: string }>(
      `select m.state, m.credits_charged::text from chat_messages m join accounts a on a.id = m.account_id
       where a.email = $1 and m.role = 'user' order by m.created_at`,
      [email],
    );
    expect(states.rows).toEqual([
      { state: "completed", credits_charged: "19" },
      { state: "declined_out_of_scope", credits_charged: "19" },
    ]);
  });

  test("deep answers query the loaded files in the browser and link cells to their query", async () => {
    await page.goto(`/app/companies/${await companyId()}/chat`);
    await page.getByTestId("chat-type").selectOption("deep");
    await page.getByLabel("Your question").fill("Which head has the largest closing balance?");
    await expect(page.getByTestId("chat-send")).toBeDisabled();
    await page.getByLabel("Load files for Deep answers").setInputFiles([...SETUP_MONTHS, "2026-05"].map(tb));
    await expect(page.getByTestId("chat-session")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("chat-send")).toContainText("99 credits");
    await page.getByTestId("chat-send").click();
    const answer = page.getByTestId("chat-answer").last();
    await expect(answer).toContainText("The largest closing balance by head is", { timeout: 60_000 });
    await answer.locator("[data-lineage='q1']").first().click();
    await expect(page.getByTestId("query-lineage")).toContainText("closing_paise");
    await expect(page.getByTestId("query-lineage")).toContainText("balances");

    const steps = await db.query<{ status: string; row_count: number }>(
      `select s.status, s.row_count from chat_query_steps s join accounts a on a.id = s.account_id where a.email = $1`,
      [email],
    );
    expect(steps.rows).toHaveLength(1);
    expect(steps.rows[0]?.status).toBe("ok");
    expect(steps.rows[0]?.row_count).toBeGreaterThan(0);
  });

  test("edit proposes a patch, applies on confirmation, and undoes; Investigate opens a Deep question", async () => {
    const id = await companyId();
    await page.goto(`/app/companies/${id}/chat`);
    await page.getByTestId("chat-type").selectOption("edit");
    await page.getByLabel("Your question").fill("Rename the first card to Sales");
    await page.getByTestId("chat-send").click();
    await expect(page.getByTestId("chat-edit-preview").last()).toContainText("/widgets/0/title");
    await page.getByRole("button", { name: "Apply change" }).click();
    await expect(page.getByTestId("chat-edit").last()).toContainText("Applied to the dashboard");
    await page.goto(`/app/companies/${id}/dashboard`);
    await expect(page.getByTestId("widget-kpi_revenue")).toContainText("Sales");
    await page.getByRole("button", { name: "Undo last change" }).click();
    await expect(page.getByTestId("widget-kpi_revenue")).toContainText("Revenue");
    await page.getByTestId("widget-kpi_revenue").getByRole("link", { name: "Investigate" }).click();
    await expect(page).toHaveURL(/\/chat\?investigate=revenue/u);
    await expect(page.getByLabel("Your question")).toHaveValue(/Why did Revenue from operations move/u);
  });
});

test("no Content Security Policy violations anywhere in the flow (SPEC §30)", () => {
  expect(csp).toEqual([]);
});
