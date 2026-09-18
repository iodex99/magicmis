/**
 * Phase 6 browser acceptance (SPEC §23, §24.1, §34): a company is set up from 13 monthly trial
 * balances and then refreshed with the next month, entirely through the UI. Files are uploaded and
 * processed on the server (ADR 0032); nothing stops for review. The refresh on a matching file
 * makes zero AI calls. The workbook downloads and opens.
 */

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { periodLabel } from "@magicmis/render-dashboard";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import * as XLSX from "xlsx";

import { FIXTURES_OUT } from "./fixtures-setup";
import { createVerifiedAccount, uniqueEmail, watchCspViolations } from "./helpers";

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
  await createVerifiedAccount(page, email);
  const consent = await page.request.post("/api/account/consents", {
    data: { document: "processing" },
    headers: { "idempotency-key": randomUUID() },
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

async function runJob(files: string[]) {
  await page.getByLabel("Choose files").setInputFiles(files);
  await expect(page.getByTestId("job-files").getByRole("row")).toHaveCount(
    files.length + 1,
  );
  // SPEC §2.3: before the price is confirmed, no recognition results.
  await expect(page.locator("main")).not.toContainText(
    /Sundry Debtors|Northwind|Revenue/u,
  );
  // One button starts the run once the uploads are in; there is no price step (ADR 0033).
  await expect(page.getByTestId("job-run")).toBeEnabled({ timeout: 120_000 });
  await page.getByTestId("job-run").click();
  // The server runs it through: no review, no questions.
  await expect(page.getByTestId("job-done")).toBeVisible({ timeout: 240_000 });
}

test("sets up a company from thirteen months of trial balances", async () => {
  await page.goto("/app");
  await page.getByLabel("Company name").fill("Synthetic Hardware Traders");
  await page.getByRole("button", { name: "Add company" }).click();
  // A new company is set up from its own workspace (ADR 0033).
  await expect(page).toHaveURL(/\/app\/companies\/[0-9a-f-]+$/u);
  await expect(page.getByLabel("Choose files")).toBeEnabled();

  await runJob(SETUP_MONTHS.map(tb));
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
  await page.getByRole("link", { name: "Add a month" }).click();
  await expect(page.getByLabel("Choose files")).toBeEnabled();
  await runJob([tb("2026-05")]);
  await expect(page.getByTestId("job-done")).toContainText("299 credits charged");

  expect(await aiCallsForAccount()).toBe(0);
  const r = await db.query<{ type: string; state: string; captured_credits: string }>(
    `select j.type, j.state, j.captured_credits::text from jobs j join accounts a on a.id = j.account_id
      where a.email = $1 and j.state not in ('draft', 'estimated', 'cancelled')
      order by j.created_at`,
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
  // The company page is the workspace: the dashboard with the assistant beside it.
  await page.goto(`/app/companies/${companyId}`);
  await expect(page.getByTestId("assistant")).toBeVisible();
  await page.getByRole("button", { name: "Build the dashboard" }).click();

  const revenue = page.getByTestId("widget-kpi_revenue");
  await expect(revenue).toBeVisible();
  await expect(page.getByTestId("period-filter")).toHaveValue("2026-05");
  await revenue.locator("[data-metric-key='revenue@2026-05']").click();
  await expect(page.getByTestId("lineage-panel")).toContainText("revenue");
  await expect(page.getByTestId("lineage-panel")).toContainText("Formula");
  // Lineage opens in a drawer; Escape closes it.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("lineage-panel")).toHaveCount(0);

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

test("the rail and the chat fold away, the chat stays one press from anywhere, and edit tools stay inside their cards", async () => {
  const company = await db.query<{ id: string }>(
    `select c.id from companies c join accounts a on a.id = c.account_id where a.email = $1`,
    [email],
  );
  const companyId = company.rows[0]?.id ?? "";
  await page.goto(`/app/companies/${companyId}`);
  const revenue = page.getByTestId("widget-kpi_revenue");
  await expect(revenue).toBeVisible();

  // ADR 0044: four words beside a title did not fit a narrow card and ran out through its
  // rounded corner. Measured, not eyeballed: every control sits inside its card, and no card
  // scrolls sideways. Checked with the chat open, which is when the cards are narrowest.
  await page.getByRole("button", { name: "Edit layout" }).click();
  const cards = page.locator("section[data-testid^='widget-']");
  const count = await cards.count();
  expect(count).toBeGreaterThan(3);
  for (let i = 0; i < count; i += 1) {
    const card = cards.nth(i);
    const box = await card.boundingBox();
    if (box === null) throw new Error("card has no box");
    const tools = card.getByTestId("widget-tools").getByRole("button");
    expect(await tools.count()).toBe(4);
    for (const tool of await tools.all()) {
      const t = await tool.boundingBox();
      if (t === null) throw new Error("tool has no box");
      expect(t.x).toBeGreaterThanOrEqual(box.x);
      expect(t.x + t.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
      expect(t.y + t.height).toBeLessThanOrEqual(box.y + box.height + 0.5);
    }
    expect(
      await card.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      "a card scrolls sideways",
    ).toBe(true);
  }
  await page.getByRole("button", { name: "Done editing" }).click();

  // The chat can be put away, and stays put away across a reload…
  const panel = page.getByTestId("chat-panel");
  const launcher = page.getByTestId("chat-launcher");
  const question = page.getByLabel("Your question");
  await expect(panel).toBeVisible();
  const grid = revenue.locator("xpath=..");
  const narrow = (await grid.boundingBox())?.width ?? 0;
  await page.getByTestId("chat-collapse").click();
  await expect(panel).toBeHidden();
  await expect(launcher).toBeVisible();
  // …which gives the dashboard the room it took.
  await expect
    .poll(async () => (await grid.boundingBox())?.width ?? 0)
    .toBeGreaterThan(narrow + 200);
  await page.reload();
  await expect(launcher).toBeVisible();
  await expect(panel).toBeHidden();

  // …and is never out of reach: the launcher, the keyboard, and Investigate all bring it back
  // with the cursor in the question box.
  await launcher.click();
  await expect(panel).toBeVisible();
  await expect(question).toBeFocused();
  await page.keyboard.press("Control+k");
  await expect(panel).toBeHidden();
  await page.keyboard.press("Control+k");
  await expect(panel).toBeVisible();
  await expect(question).toBeFocused();
  await page.getByTestId("chat-collapse").click();
  await revenue.getByRole("button", { name: "Investigate" }).click();
  await expect(panel).toBeVisible();
  await expect(question).toHaveValue(/Why did/u);
  await question.fill("");

  // The rail folds to icons, keeps every name, and remembers.
  const rail = page.getByTestId("rail");
  await page.getByTestId("rail-toggle").click();
  await expect(rail).toHaveAttribute("data-collapsed", "true");
  // The width eases over a fifth of a second, so it is polled rather than read once.
  await expect
    .poll(async () => (await rail.boundingBox())?.width ?? 999)
    .toBeLessThan(90);
  await expect(rail.getByRole("link", { name: "Wallet" })).toBeVisible();
  await expect(rail.getByRole("link", { name: "Chat with the MIS" })).toBeVisible();
  await page.reload();
  await expect(rail).toHaveAttribute("data-collapsed", "true");

  // From a page that is not about any company, the rail still opens this company's chat.
  await page.getByTestId("chat-collapse").click();
  await rail.getByRole("link", { name: "Wallet" }).click();
  await expect(page).toHaveURL(/\/wallet$/u);
  await page.getByTestId("rail-chat").click();
  await expect(page).toHaveURL(new RegExp(`/app/companies/${companyId}$`, "u"));
  await expect(panel).toBeVisible();
  await expect(question).toBeFocused();

  // Left as the rest of the file expects it: rail open, chat open.
  await page.getByTestId("rail-toggle").click();
  await expect(rail).toHaveAttribute("data-collapsed", "false");
});

test("sets up a company that recreates the user's reference MIS with no AI call", async () => {
  const { referenceMisWorkbook } = await import("@magicmis/fixtures");
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(path.join(tmpdir(), "reference-mis-"));
  const referencePath = path.join(dir, "Client_MIS.xlsx");
  await writeFile(referencePath, await referenceMisWorkbook({ rulesOnly: true }));

  await page.goto("/app");
  await page.getByRole("button", { name: /^Add a company/u }).click();
  await page.getByLabel("Company name").fill("Synthetic Recreated Traders");
  await page.getByRole("button", { name: "Add company" }).click();
  await expect(page.getByLabel("Choose files")).toBeEnabled();
  await page.getByLabel("Choose files").setInputFiles(SETUP_MONTHS.map(tb));
  await page.getByLabel("Choose reference MIS").setInputFiles(referencePath);
  await expect(page.getByTestId("job-reference")).toContainText("sheets", {
    timeout: 60_000,
  });
  // Before payment, nothing from the reference's rows is shown.
  await expect(page.locator("main")).not.toContainText(/Sundry Debtors|Net Profit/u);

  // With a reference added, the one button runs a recreate.
  await expect(page.getByTestId("job-run")).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId("job-run").click();

  // The layout is bound by rules and accepted as proposed: no review screen.
  await expect(page.getByTestId("job-done")).toContainText("1,498 credits charged", {
    timeout: 240_000,
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
  const totalIncome = rows.find((r) => r[0] === "Total Income");
  expect(typeof totalIncome?.[1]).toBe("number");

  // Exactly one charged job; nothing is created before the button is pressed.
  const job = await db.query<{ type: string; state: string }>(
    `select j.type, j.state from jobs j join companies c on c.id = j.company_id join accounts a on a.id = c.account_id
     where c.name = 'Synthetic Recreated Traders' and a.email = $1
       and j.state not in ('draft', 'estimated', 'cancelled')`,
    [email],
  );
  expect(job.rows).toEqual([{ type: "reference_mis_recreate", state: "completed" }]);

  const abandoned = await db.query<{ state: string; captured: string }>(
    `select j.state, coalesce(j.captured_credits, 0)::text as captured
       from jobs j join companies c on c.id = j.company_id join accounts a on a.id = c.account_id
      where c.name = 'Synthetic Recreated Traders' and a.email = $1 and j.state = 'cancelled'`,
    [email],
  );
  expect(abandoned.rows.every((r) => r.captured === "0")).toBe(true);
  expect(await aiCallsForAccount()).toBe(0);
});

test.describe("chat with the MIS", () => {
  const CHAT_STAGES = ["chat_quick", "chat_deep", "chat_edit", "thread_summary"];
  let activated: string[] = [];

  test.beforeAll(async () => {
    // The local stack has no prompt activated (R-28); these tests drive the fake model.
    const r = await db.query<{ id: string }>(
      `update tier_routing set prompt_version = case when stage = 'chat_edit' then 2 else 1 end
        where stage = any($1) and prompt_version is null returning id`,
      [CHAT_STAGES],
    );
    activated = r.rows.map((x) => x.id);
  });
  test.afterAll(async () => {
    await db.query(`update tier_routing set prompt_version = null where id = any($1)`, [
      activated,
    ]);
  });

  const companyId = async () => {
    const r = await db.query<{ id: string }>(
      `select c.id from companies c join accounts a on a.id = c.account_id where a.email = $1 and c.name = 'Synthetic Hardware Traders'`,
      [email],
    );
    return r.rows[0]?.id ?? "";
  };

  test("quick answers resolve placeholders with lineage; out-of-scope is declined and charged", async () => {
    await page.goto(`/app/companies/${await companyId()}`);
    await expect(page.getByText("including questions outside this MIS")).toBeVisible();
    await page.getByLabel("Your question").fill("How did revenue move this month?");
    await page.getByTestId("chat-send").click();
    const answer = page.getByTestId("chat-answer").last();
    await expect(answer).toContainText("The figure you asked about is");
    await answer.locator("[data-lineage^='revenue']").first().click();
    await expect(page.getByTestId("lineage-panel")).toContainText("Formula");
    await page.keyboard.press("Escape");

    await page.getByLabel("Your question").fill("Write me a poem about the sea.");
    await page.getByTestId("chat-send").click();
    await expect(page.getByTestId("chat-user").last()).toContainText(
      "outside this MIS · 19 credits",
    );
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

  test("deep answers query the company's figures on the server and link cells to their query", async () => {
    await page.goto(`/app/companies/${await companyId()}`);
    await page
      .getByTestId("chat-type")
      .getByRole("radio", { name: "Dig deeper" })
      .click();
    await page
      .getByLabel("Your question")
      .fill("Which head has the largest closing balance?");
    // Nothing to load: the queries run on the server (ADR 0032).
    await expect(page.getByTestId("chat-session")).toBeVisible();
    await page.getByTestId("chat-send").click();
    const answer = page.getByTestId("chat-answer").last();
    await expect(answer).toContainText("The largest closing balance by head is", {
      timeout: 60_000,
    });
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

  test("one box: a message that changes the dashboard says so, is applied as it is answered, and undoes; Investigate opens a Deep question", async () => {
    const id = await companyId();
    await page.goto(`/app/companies/${id}`);
    const question = page.getByLabel("Your question");
    // ADR 0046: no mode is picked. A question is a question…
    await question.fill("Why did revenue fall in May?");
    await expect(page.getByTestId("chat-building")).toHaveCount(0);
    // …and a change to the dashboard is announced before it is sent, with a way out of it.
    await question.fill("Rename the first card to Sales");
    await expect(page.getByTestId("chat-building")).toContainText(
      "This will update the dashboard",
    );
    await page.getByRole("button", { name: "Ask it instead" }).click();
    await expect(page.getByTestId("chat-building")).toHaveCount(0);
    await question.fill("");
    await question.fill("Rename the first card to Sales");
    await expect(page.getByTestId("chat-building")).toBeVisible();
    await page.getByTestId("chat-send").click();

    // Nothing to accept: the dashboard beside the conversation already shows it.
    const edit = page.getByTestId("chat-edit").last();
    await expect(edit).toContainText("Done. It is on the dashboard", { timeout: 60_000 });
    await expect(edit.getByRole("button", { name: "Apply change" })).toHaveCount(0);
    await expect(page.getByTestId("widget-kpi_revenue")).toContainText("Sales");
    await edit.getByText("The exact change").click();
    await expect(page.getByTestId("chat-edit-preview").last()).toContainText(
      "/widgets/0/title",
    );
    // It is still applied after a reload, and one press undoes it.
    await page.reload();
    await expect(page.getByTestId("widget-kpi_revenue")).toContainText("Sales");
    // The conversation is in History, newest first, and still says what it did.
    await page.getByRole("button", { name: "History" }).click();
    await page.getByTestId("assistant-history").getByRole("button").first().click();
    await expect(page.getByTestId("chat-edit").last()).toContainText(
      "Done. It is on the dashboard",
    );
    await page
      .getByTestId("chat-edit")
      .last()
      .getByRole("button", { name: "Undo" })
      .click();
    await expect(page.getByTestId("widget-kpi_revenue")).toContainText("Revenue");
    await expect(page.getByTestId("chat-edit").last()).toContainText("Undone");

    await page
      .getByTestId("widget-kpi_revenue")
      .getByRole("button", { name: "Investigate" })
      .click();
    // Investigate hands the question to the assistant beside the dashboard.
    await expect(page).toHaveURL(new RegExp(`/app/companies/${id}$`, "u"));
    await expect(page.getByLabel("Your question")).toHaveValue(
      /Why did Revenue from operations move/u,
    );
    await page.getByLabel("Your question").fill("");
    await page
      .getByTestId("chat-type")
      .getByRole("radio", { name: "Ask", exact: true })
      .click();

    // After a reload the reply no longer claims a change the dashboard has moved past, and no
    // longer offers an Undo that could only fail.
    await page.reload();
    await expect(page.getByTestId("widget-kpi_revenue")).toContainText("Revenue");
    await page.getByRole("button", { name: "History" }).click();
    await page.getByTestId("assistant-history").getByRole("button").first().click();
    await expect(page.getByTestId("chat-edit-moved").last()).toContainText(
      "The dashboard has changed since",
    );
    await expect(
      page.getByTestId("chat-edit").last().getByRole("button", { name: "Undo" }),
    ).toHaveCount(0);
  });

  test("the dashboard is built by chatting: a comparison box and a formula the engine computes, then presented full screen", async () => {
    const id = await companyId();
    await page.goto(`/app/companies/${id}`);
    const question = page.getByLabel("Your question");
    await expect(page.getByTestId("widget-kpi_revenue")).toBeVisible();
    const before = await page.locator("section[data-testid^='widget-']").count();
    const MAY = periodLabel("2026-05");
    const APRIL = periodLabel("2026-04");
    const MAY_LAST_YEAR = periodLabel("2025-05");

    await question.fill("Add a box comparing revenue and profit with last year");
    await expect(page.getByTestId("chat-building")).toBeVisible();
    await page.getByTestId("chat-send").click();
    const comparison = page.getByTestId("comparison");
    await expect(comparison).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("section[data-testid^='widget-']")).toHaveCount(before + 1);
    // This month, the same month last year, and the change: three figures a row, all the
    // engine's own, each open to its lineage.
    for (const head of [MAY, MAY_LAST_YEAR, "Change"])
      await expect(comparison.getByRole("columnheader", { name: head })).toBeVisible();
    const revenueRow = comparison.getByRole("row").filter({ hasText: "Revenue" });
    await expect(revenueRow.locator("[data-metric-key='revenue@2026-05']")).toBeVisible();
    await expect(revenueRow.locator("[data-metric-key='revenue@2025-05']")).toBeVisible();
    await expect(
      revenueRow.locator("[data-metric-key='revenue.yoy_abs@2026-05']"),
    ).toBeVisible();

    // A figure the catalog does not hold. The chat wrote the formula; the engine did the sum.
    await question.fill("Add a card showing staff cost as a share of revenue");
    await page.getByTestId("chat-send").click();
    const card = page
      .locator("section[data-testid^='widget-kpi_staff_share']")
      .filter({ hasText: "Staff cost share of revenue" });
    await expect(card).toBeVisible({ timeout: 60_000 });
    const figure = card
      .locator("[data-metric-key^='calc_staff_share'][data-metric-key$='@2026-05']")
      .first();
    await expect(figure).toHaveText(/^\d+\.\d%$/u);
    await figure.click();
    await expect(page.getByTestId("lineage-panel")).toContainText(
      "Staff cost share of revenue = (Employee cost ÷ Revenue from operations) × 100",
    );
    await expect(page.getByTestId("lineage-panel")).toContainText("Employee cost");
    await page.keyboard.press("Escape");

    // Exactly what the engine computes from the two stored figures, to the displayed place.
    const stored = await page.evaluate(async (companyId) => {
      const r = await fetch(`/api/companies/${companyId}/dashboard`);
      const body = (await r.json()) as {
        values: { metricId: string; period: string; value: string | null }[];
      };
      const at = (metricId: string) =>
        body.values.find((v) => v.metricId === metricId && v.period === "2026-05")?.value;
      return {
        revenue: at("revenue"),
        staff: at("employee_cost"),
        share: body.values.find(
          (v) =>
            v.metricId.startsWith("calc_staff_share") &&
            !v.metricId.includes(".") &&
            v.period === "2026-05",
        )?.value,
      };
    }, id);
    const expected =
      (BigInt(stored.staff ?? "0") * 100n * 1_000_000n * 2n +
        BigInt(stored.revenue ?? "1")) /
      (BigInt(stored.revenue ?? "1") * 2n);
    // Half-up here and half-even in the engine agree except on an exact tie, which this is not.
    expect(stored.share?.replace(".", "")).toBe(expected.toString());

    // Present: the dashboard alone, nothing to operate, months on the arrow keys, Esc to leave.
    await expect(page.getByRole("button", { name: /Print/u })).toHaveCount(0);
    await expect(page.getByTestId("latest-workbook")).toHaveCount(0);
    await page.getByTestId("present").click();
    const stage = page.getByTestId("stage");
    await expect(stage).toHaveAttribute("data-presenting", "true");
    await expect(page.getByTestId("present-period")).toHaveText(MAY);
    await expect(stage.getByRole("button", { name: "Investigate" })).toHaveCount(0);
    // It covers the window whether or not the browser granted the whole screen.
    const box = await stage.boundingBox();
    const viewport = page.viewportSize();
    expect([box?.x, box?.y]).toEqual([0, 0]);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual((viewport?.width ?? 0) - 20);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual((viewport?.height ?? 0) - 20);
    // The chat launcher, the rail and the edit controls are all behind it.
    await expect(stage.getByTestId("comparison")).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("present-period")).toHaveText(APRIL);
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("present-period")).toHaveText(MAY);
    // A director asks where a number came from: it still opens, on the stage.
    await stage.locator("[data-metric-key='revenue@2026-05']").first().click();
    await expect(stage.getByTestId("lineage-panel")).toContainText("revenue");
    await stage
      .getByTestId("lineage-panel")
      .getByRole("button", { name: "Close" })
      .click();
    await page.getByTestId("present-exit").click();
    await expect(stage).toHaveAttribute("data-presenting", "false");
    await expect(page.getByRole("button", { name: "Edit layout" })).toBeVisible();
  });
});

test("a company's own tables and names are remembered through the next month, and belong to it alone (ADR 0045)", async () => {
  const companies = await db.query<{ id: string; name: string }>(
    `select c.id, c.name from companies c join accounts a on a.id = c.account_id where a.email = $1`,
    [email],
  );
  const idOf = (name: string) => companies.rows.find((c) => c.name === name)?.id ?? "";
  const recreated = idOf("Synthetic Recreated Traders");
  const first = idOf("Synthetic Hardware Traders");
  expect(recreated).not.toBe("");
  expect(first).not.toBe("");

  // This company has its own tables (recreated from its reference MIS) through April. Give it
  // a dashboard and a name of its own for the first card.
  await page.goto(`/app/companies/${recreated}`);
  await page.getByRole("button", { name: "Build the dashboard" }).click();
  const card = page.getByTestId("widget-kpi_revenue");
  await expect(card).toBeVisible();
  await expect(page.getByTestId("period-filter")).toHaveValue("2026-04");
  await page.getByRole("button", { name: "Edit layout" }).click();
  page.once("dialog", (d) => void d.accept("Turnover"));
  await card.getByRole("button", { name: "Rename" }).click();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByTestId("patch-preview")).toHaveCount(0);
  await page.getByRole("button", { name: "Done editing" }).click();
  await expect(card).toContainText("Turnover");

  // The next month arrives. The workbook still has this company's tables, not the standard ones.
  await page.goto(`/app/companies/${recreated}/run`);
  await expect(page.getByLabel("Choose files")).toBeEnabled();
  await runJob([tb("2026-05")]);
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

  // The name survives the run, the paid dashboard refresh that brings May in, and a reload.
  await page.goto(`/app/companies/${recreated}`);
  await expect(card).toContainText("Turnover");
  await page.getByRole("button", { name: "Refresh the dashboard" }).click();
  await expect(page.getByTestId("period-filter")).toHaveValue("2026-05", {
    timeout: 60_000,
  });
  await expect(card).toContainText("Turnover");
  await page.reload();
  await expect(card).toContainText("Turnover");
  await expect(page.getByTestId("period-filter")).toHaveValue("2026-05");

  // The other company of the same account never heard of it.
  await page.goto(`/app/companies/${first}`);
  const other = page.getByTestId("widget-kpi_revenue");
  await expect(other).toBeVisible();
  await expect(other).toContainText("Revenue");
  await expect(other).not.toContainText("Turnover");

  // Every change was a new version on top of the last; none was written over.
  const versions = await db.query<{ version: number }>(
    `select version from blueprints where company_id = $1 order by version`,
    [recreated],
  );
  // v1 recreate, v2 dashboard, v3 rename, v4 dashboard refresh (the run changed no rules).
  expect(versions.rows.map((r) => r.version)).toEqual([1, 2, 3, 4]);
});

test("no Content Security Policy violations anywhere in the flow (SPEC §30)", () => {
  expect(csp).toEqual([]);
});
