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
import { devices, expect, test, type Page } from "@playwright/test";
import pg from "pg";
import * as XLSX from "xlsx";

import { FIXTURES_OUT } from "./fixtures-setup";
import {
  createVerifiedAccount,
  PASSWORD,
  TINY_PNG,
  uniqueEmail,
  watchCspViolations,
  welcomeGranted,
} from "./helpers";

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

/**
 * Every AI call this account has made. A test that promises a step makes none compares this before
 * and after the step, never against zero: where a stage is activated, setting a company up may
 * legitimately call the AI once (its first dashboard, ADR 0056), and the promise under test is
 * about the refresh, the edit or the recreate. CI's clean stack activates nothing, so there both
 * readings are zero.
 */
async function aiCallsForAccount(exceptStages: readonly string[] = []): Promise<number> {
  const r = await db.query<{ n: number }>(
    `select count(*)::int as n from ai_calls c join accounts a on a.id = c.account_id
      where a.email = $1 and not (c.stage = any($2::text[]))`,
    [email, [...exceptStages]],
  );
  return r.rows[0]?.n ?? -1;
}

/**
 * The fixture's books run April to March, so the company is set to match, as an Indian firm's is.
 * Left on the calendar year this browser is given, the run would rightly stop to ask (ADR 0086)
 * — and before it asked, every figure in this suite was built on the wrong year.
 */
async function aprilYear() {
  await page.getByRole("button", { name: /Reporting conventions/u }).click();
  await page.getByLabel("Financial year starts in").selectOption("4");
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
  await aprilYear();
  await page.getByRole("button", { name: "Add company" }).click();
  // A new company is set up from its own workspace (ADR 0033).
  await expect(page).toHaveURL(/\/app\/companies\/[0-9a-f-]+$/u);
  await expect(page.getByLabel("Choose files")).toBeEnabled();

  await runJob(SETUP_MONTHS.map(tb));
  await expect(page.getByTestId("job-checks")).toContainText("V11");
  await expect(page.getByTestId("job-done")).toContainText("999 credits charged");
  // Every ledger in this fixture is placed by the rules and its files hold balances, so setting
  // it up asks the model nothing but the company's first dashboard (ADR 0056, ADR 0069).
  expect(await aiCallsForAccount(["dashboard_layout"])).toBe(0);

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
    "Cash flow",
    // ADR 0087: this browser is given the international default, so the books are in dollars
    // and the statutory statements follow the MIS in the US GAAP layout.
    "Balance sheet (US GAAP)",
    "Income statement (US GAAP)",
    "Checks",
    "Data",
    "Lineage",
  ]);
  const position = JSON.stringify(
    XLSX.utils.sheet_to_json(workbook.Sheets["Balance sheet (US GAAP)"] ?? {}, {
      header: 1,
    }),
  );
  expect(position).toContain("Total liabilities and equity");
  expect(position).toContain("Retained earnings, with net income for the year to date");
  // ADR 0086: the three sections, and the cash they come to at the foot of the sheet.
  const flow = JSON.stringify(
    XLSX.utils.sheet_to_json(workbook.Sheets["Cash flow"] ?? {}, { header: 1 }),
  );
  expect(flow).toContain("Cash from operating activities");
  expect(flow).toContain("Cash from financing activities");
  expect(flow).toContain("Cash and bank at the end of the month");
  // Names are rehydrated in the browser; the Data sheet shows real party names from this session.
  expect(
    JSON.stringify(XLSX.utils.sheet_to_json(workbook.Sheets["Data"] ?? {})),
  ).toContain("Northwind");

  // ADR 0087: the email about it is in the app's inbox too, and opening the inbox reads it.
  await page.goto("/app");
  await expect(page.getByTestId("rail-count").first()).toBeVisible();
  // A post another site's form could send — no JSON content type — marks nothing (ADR 0087).
  const forged = await page.request.post("/api/account/inbox", {
    headers: { "content-type": "text/plain" },
    data: "{}",
  });
  expect(forged.status()).toBe(415);
  await expect(page.getByTestId("rail-count").first()).toBeVisible();
  await page.getByRole("link", { name: /^Inbox/u }).click();
  await expect(page.getByTestId("inbox")).toContainText("Your MIS is ready");
  await expect(page.getByTestId("rail-count")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("rail-count")).toHaveCount(0);
});

test("refreshes the next month with no review and zero AI calls", async () => {
  const aiBefore = await aiCallsForAccount();
  await page.goto("/app");
  await page.getByRole("link", { name: "Add a file" }).click();
  await expect(page.getByLabel("Choose files")).toBeEnabled();
  // A wallet with credits in it gets no nudge.
  await expect(page.getByTestId("job-empty-wallet")).toHaveCount(0);

  // ADR 0049: part-way through, a run can find it needs more analysis than its price covers.
  // The server pauses it with a quote; the screen must offer to carry on, not call it a failure.
  // The pause is simulated at the boundary (the first answer from the run is replaced, before
  // it reaches the server, and the acceptance is acknowledged); the run that follows is real.
  let paused = false;
  await page.route(/\/api\/jobs\/[^/]+\/run$/u, async (route) => {
    if (paused) return route.continue();
    paused = true;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "needs_quote",
        message: "This job needs more analysis than its price covers.",
        capturedCredits: "0",
        outputId: null,
        fileName: null,
        checks: [],
        notices: [],
        quoteCredits: "450",
      }),
    });
  });
  await page.route(/\/api\/jobs\/[^/]+\/accept-quote$/u, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
  await page.getByLabel("Choose files").setInputFiles([tb("2026-05")]);
  await expect(page.getByTestId("job-run")).toBeEnabled({ timeout: 120_000 });
  await page.getByTestId("job-run").click();
  await expect(page.getByText("Paused: this one needs a little more")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId("job-quote")).toHaveText("450");
  await expect(page.getByText("Nothing has been charged")).toBeVisible();
  await expect(page.getByText("The job could not be completed")).toHaveCount(0);
  // The file is still there: nothing has to be added again.
  await expect(page.getByTestId("job-files")).toContainText("trial_balance_2026-05.xlsx");
  await page.getByRole("button", { name: "Accept and carry on" }).click();
  await expect(page.getByTestId("job-done")).toBeVisible({ timeout: 240_000 });
  await page.unroute(/\/api\/jobs\/[^/]+\/run$/u);
  await page.unroute(/\/api\/jobs\/[^/]+\/accept-quote$/u);
  await expect(page.getByTestId("job-done")).toContainText("299 credits charged");

  // The recurring margin: a refresh on unchanged structure, and the dashboard refresh it brings,
  // make no AI call at all.
  expect(await aiCallsForAccount()).toBe(aiBefore);
  const r = await db.query<{ type: string; state: string; captured_credits: string }>(
    `select j.type, j.state, j.captured_credits::text from jobs j join accounts a on a.id = j.account_id
      where a.email = $1 and j.state not in ('draft', 'estimated', 'cancelled')
      order by j.created_at`,
    [email],
  );
  expect(r.rows).toEqual([
    { type: "company_setup", state: "completed", captured_credits: "999" },
    // One press: the run delivers the workbook, then the dashboard as its own priced action.
    { type: "dashboard_addon", state: "completed", captured_credits: "299" },
    { type: "monthly_refresh", state: "completed", captured_credits: "299" },
    { type: "dashboard_refresh", state: "completed", captured_credits: "99" },
  ]);
  await expect(page.getByTestId("job-dashboard")).toContainText(
    "The dashboard was updated: 99 credits",
  );
  const wallet = await db.query<{ balance_credits: string; held_credits: string }>(
    `select w.balance_credits::text, w.held_credits::text from wallets w join accounts a on a.id = w.account_id where a.email = $1`,
    [email],
  );
  // Whatever welcome credits this account started with are spent first and add to the balance
  // like any other lot (ADR 0068); the network limit decides whether it got them at all.
  const welcome = await welcomeGranted(email);
  expect(wallet.rows[0]).toEqual({
    balance_credits: (20_000n + welcome - 999n - 299n - 299n - 99n).toString(),
    held_credits: "0",
  });
});

test("adds the dashboard, opens lineage from a number, edits with preview, and undoes", async () => {
  const aiBefore = await aiCallsForAccount();
  const company = await db.query<{ id: string }>(
    `select c.id from companies c join accounts a on a.id = c.account_id where a.email = $1`,
    [email],
  );
  const companyId = company.rows[0]?.id ?? "";
  // The company page is the workspace: the dashboard with the assistant beside it.
  await page.goto(`/app/companies/${companyId}`);
  await expect(page.getByTestId("assistant")).toBeVisible();
  // Nothing to build or refresh by hand: the runs put both months on the board (ADR 0047).
  await expect(page.getByRole("button", { name: "Build the dashboard" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh the dashboard" })).toHaveCount(
    0,
  );

  const revenue = page.getByTestId("widget-kpi_revenue");
  await expect(revenue).toBeVisible();
  await expect(page.getByTestId("period-filter")).toHaveValue("2026-05");
  // ADR 0087: every month the setup computed is on the picker, not only the two snapshots'.
  await expect(page.getByTestId("period-filter").locator("option")).toHaveCount(14);
  // What the run proved about the month on screen, in words rather than V-numbers.
  await expect(page.getByTestId("board-checks")).toContainText("checks passed for");
  await page.getByTestId("board-checks").locator("summary").click();
  await expect(page.getByTestId("board-checks")).toContainText(
    "The trial balance balances",
  );
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
  // v1 setup, v2 dashboard (with the setup), v3 dashboard refresh (with May), v4 rename, v5 undo.
  expect(versions.rows[0]?.n).toBe(5);
  expect(await aiCallsForAccount()).toBe(aiBefore);
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
  // A new company's first dashboard is chosen by its own priced action, which calls the AI once
  // where that stage is activated (ADR 0056). The promise here is about recreating the MIS.
  const aiBefore = await aiCallsForAccount(["dashboard_layout"]);
  const { referenceMisWorkbook } = await import("@magicmis/fixtures");
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(path.join(tmpdir(), "reference-mis-"));
  const referencePath = path.join(dir, "Client_MIS.xlsx");
  await writeFile(referencePath, await referenceMisWorkbook({ rulesOnly: true }));

  await page.goto("/app");
  // This account already has a company by now, and the form is still open (ADR 0061).
  await page.getByLabel("Company name").fill("Synthetic Recreated Traders");
  await aprilYear();
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
    "Balance sheet (US GAAP)",
    "Income statement (US GAAP)",
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
       and j.state not in ('draft', 'estimated', 'cancelled')
     order by j.created_at`,
    [email],
  );
  expect(job.rows).toEqual([
    { type: "reference_mis_recreate", state: "completed" },
    { type: "dashboard_addon", state: "completed" },
  ]);

  const abandoned = await db.query<{ state: string; captured: string }>(
    `select j.state, coalesce(j.captured_credits, 0)::text as captured
       from jobs j join companies c on c.id = j.company_id join accounts a on a.id = c.account_id
      where c.name = 'Synthetic Recreated Traders' and a.email = $1 and j.state = 'cancelled'`,
    [email],
  );
  expect(abandoned.rows.every((r) => r.captured === "0")).toBe(true);
  expect(await aiCallsForAccount(["dashboard_layout"])).toBe(aiBefore);
});

test.describe("chat with the MIS", () => {
  const CHAT_STAGES = [
    "chat_quick",
    "chat_deep",
    "chat_edit",
    "thread_summary",
    // The two documents the assistant writes about a month (ADR 0084).
    "commentary",
    "board_actions",
  ];
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

  test("a box can be taken off and another put in its place, in one message (ADR 0046)", async () => {
    // The owner's question in their own words: "remove the EBITDA box and instead build
    // something else". One message, one charge, one patch that both removes and adds.
    const id = await companyId();
    await page.goto(`/app/companies/${id}`);
    const ebitda = page.getByTestId("widget-kpi_ebitda");
    await expect(ebitda).toBeVisible();
    const before = await page.locator("section[data-testid^='widget-']").count();

    const question = page.getByLabel("Your question");
    await question.fill("Remove the EBITDA box and put a revenue trend there instead");
    // It is announced as a change before it is sent, like every other layout change.
    await expect(page.getByTestId("chat-building")).toContainText(
      "This will update the dashboard",
    );
    await page.getByTestId("chat-send").click();

    await expect(page.getByTestId("chat-edit").last()).toContainText(
      "Done. It is on the dashboard",
      { timeout: 60_000 },
    );
    // The box is gone, the new one is there, and the count is unchanged because one replaced one.
    await expect(ebitda).toHaveCount(0);
    const trend = page
      .locator("section[data-testid^='widget-trend_']")
      .filter({ hasText: "Revenue trend" });
    await expect(trend).toBeVisible();
    await expect(page.locator("section[data-testid^='widget-']")).toHaveCount(before);

    // It is the saved layout now, not a view of it: a reload shows the same board.
    await page.reload();
    await expect(page.getByTestId("widget-kpi_ebitda")).toHaveCount(0);
    await expect(
      page
        .locator("section[data-testid^='widget-trend_']")
        .filter({ hasText: "Revenue trend" }),
    ).toBeVisible();

    // And it is one press to put it back.
    await page.getByRole("button", { name: "History" }).click();
    await page.getByTestId("assistant-history").getByRole("button").first().click();
    await page
      .getByTestId("chat-edit")
      .last()
      .getByRole("button", { name: "Undo" })
      .click();
    await expect(page.getByTestId("widget-kpi_ebitda")).toBeVisible();
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

    // "Where to act" sits on the board, not behind the assistant (ADR 0063): a board member
    // asks what to do before they ask what happened, so the button that answers it is in view
    // whenever the board is, without opening anything first.
    await expect(page.getByTestId("where-to-act")).toBeVisible();
    await expect(page.getByTestId("where-to-act")).toBeEnabled();

    // Reading the board differently is free and changes nothing (ADR 0064). Range widens every
    // box that shows several months and leaves the ones stating a single month alone, which is
    // what makes it safe to apply to the whole board at once.
    const aiBefore = await aiCallsForAccount();
    const trend = page.getByTestId("widget-trend_revenue");
    const capital = page.getByTestId("widget-working_capital");
    const JULY = periodLabel("2025-07");
    await expect(trend).not.toContainText(JULY);
    await page.getByTestId("range-filter").selectOption("n12");
    await expect(trend).toContainText(JULY);
    // A single-month box is untouched by the range, however wide it is set.
    await expect(capital).toContainText(MAY);
    await expect(capital).not.toContainText(JULY);
    // Last year beside each series, and away again. The values list names the second
    // series by its own months rather than by a suffix, so that is what to look for.
    await page.getByTestId("range-filter").selectOption("saved");
    await expect(trend).not.toContainText(MAY_LAST_YEAR);
    await page.getByTestId("compare-filter").selectOption("last_year");
    await expect(trend).toContainText(MAY_LAST_YEAR);
    await page.getByTestId("compare-filter").selectOption("saved");
    await expect(trend).not.toContainText(MAY_LAST_YEAR);
    // No AI call, and nothing saved: a reload brings the board back as its owner left it.
    expect(await aiCallsForAccount()).toBe(aiBefore);
    await page.reload();
    await expect(page.getByTestId("range-filter")).toHaveValue("saved");
    await expect(page.getByTestId("widget-trend_revenue")).not.toContainText(JULY);

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

    // The company's own logo is beside its name on the header and in the room.
    const put = await page.request.put(`/api/companies/${id}/logo`, {
      headers: { "content-type": "application/octet-stream" },
      data: TINY_PNG,
    });
    expect(put.status()).toBe(200);
    await page.reload();
    await expect(page.locator("header").getByTestId("company-logo")).toBeVisible();
    await page.getByTestId("present").click();
    const presentedLogo = stage.getByTestId("company-logo").locator("img");
    await expect(presentedLogo).toBeVisible();
    expect(
      await presentedLogo.evaluate((img) => (img as HTMLImageElement).naturalWidth),
    ).toBeGreaterThan(0);
    // Nobody is named as the preparer until the account turns it on (ADR 0087).
    await expect(stage.getByTestId("present-preparer")).toHaveCount(0);
    await page.getByTestId("present-exit").click();

    // An accountant presenting a client's board turns it on in the profile, with their own mark.
    const mark = await page.request.put("/api/account/brand/logo", {
      headers: { "content-type": "application/octet-stream" },
      data: TINY_PNG,
    });
    expect(mark.status()).toBe(200);
    await page.goto("/settings/profile");
    await page.getByLabel(/as the preparer/u).check();
    await expect(page.getByLabel(/as the preparer/u)).toBeChecked();
    // The box ticks at once and is disabled until the save lands: leaving before then cancels it.
    await expect(page.getByLabel(/as the preparer/u)).toBeEnabled();
    await page.goto(`/app/companies/${id}`);
    await page.getByTestId("present").click();
    await expect(stage.getByTestId("present-preparer")).toContainText("Prepared by");
    await expect(stage.getByTestId("present-preparer").locator("img")).toBeVisible();
    await page.getByTestId("present-exit").click();
    // Off again: an owner presenting their own business is nobody's client.
    const off = await page.request.patch("/api/account/brand", { data: { on: false } });
    expect(off.ok()).toBe(true);
  });

  test("where to act and the commentary are written, charged and shown (ADR 0084)", async () => {
    // Neither had been pressed by a test. The first run against the real model found both
    // broken: the job route refused `board_actions` with a 422, and the facts pack both of them
    // read threw on any margin, ratio or days figure whose change is a decimal.
    // Open, because an earlier test folds the chat away and the choice is remembered (ADR 0044).
    await page.goto(`/app/companies/${await companyId()}?chat=open`);
    await page.getByTestId("where-to-act").click();
    await expect(page.getByTestId("board-actions")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("board-actions")).toContainText(
      "Review the largest movement with the accountant",
      { timeout: 60_000 },
    );

    await page.getByRole("radio", { name: "Commentary" }).click();
    await page.getByTestId("commentary-write").click();
    await expect(page.getByTestId("commentary").last()).toContainText(
      "The month is led by",
      {
        timeout: 60_000,
      },
    );

    // Each is its own priced job, completed and captured at its price.
    const jobs = await db.query<{ type: string; state: string; captured: boolean }>(
      `select j.type, j.state,
              exists (select 1 from credit_ledger l
                       where l.job_id = j.id and l.entry_type = 'capture') as captured
         from jobs j join accounts a on a.id = j.account_id
        where a.email = $1 and j.type in ('board_actions', 'commentary')
        order by j.created_at`,
      [email],
    );
    expect(jobs.rows).toEqual([
      { type: "board_actions", state: "completed", captured: true },
      { type: "commentary", state: "completed", captured: true },
    ]);
  });

  // Inside the chat block, whose stages are switched on for it: a clean stack has none on.
  test("an answer is kept on the board as a box of its own, and Undo takes it off (ADR 0087)", async () => {
    const company = await db.query<{ id: string }>(
      `select c.id from companies c join accounts a on a.id = c.account_id
        where a.email = $1 and c.name = 'Synthetic Hardware Traders'`,
      [email],
    );
    await page.goto(`/app/companies/${company.rows[0]?.id ?? ""}?chat=open`);
    await page.getByLabel("Your question").fill("How did revenue move this month?");
    await page.getByTestId("chat-send").click();
    const answer = page.getByTestId("chat-answer").last();
    await expect(answer).toContainText("The figure you asked about is", {
      timeout: 60_000,
    });
    await answer.getByTestId("chat-pin").click();
    await expect(answer.getByTestId("chat-pin")).toContainText("On the board");
    const pinned = page.locator("[data-testid^='widget-pin_']");
    await expect(pinned).toBeVisible();
    // Each figure in it still opens its lineage, like any box's.
    await pinned.locator("[data-metric-key]").first().click();
    await expect(page.getByTestId("lineage-panel")).toBeVisible();
    await page
      .getByTestId("lineage-panel")
      .getByRole("button", { name: "Close" })
      .click();
    await page.getByRole("button", { name: "Undo last change" }).click();
    await expect(pinned).toHaveCount(0);
  });
});

test("an alert the owner sets is said in words on the board's month, and taken off again (ADR 0087)", async () => {
  const company = await db.query<{ id: string }>(
    `select c.id from companies c join accounts a on a.id = c.account_id
      where a.email = $1 and c.name = 'Synthetic Hardware Traders'`,
    [email],
  );
  const id = company.rows[0]?.id ?? "";
  // Cash above nothing fires on any month that has cash.
  const set = await page.request.post(`/api/companies/${id}/alerts`, {
    data: { metricId: "cash_and_bank", comparator: "above", value: "0" },
    headers: { "idempotency-key": randomUUID() },
  });
  expect(set.status()).toBe(200);
  await page.goto(`/app/companies/${id}/manage`);
  await expect(page.getByTestId("company-alert")).toContainText(
    "Cash and bank balances is above",
  );
  await page.goto(`/app/companies/${id}`);
  await expect(page.getByTestId("board-alerts")).toContainText(
    "Cash and bank balances is above",
  );
  // Taken off on Files and settings, and the board says nothing more.
  await page.goto(`/app/companies/${id}/manage`);
  await page.getByTestId("company-alert").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByTestId("company-alert")).toHaveCount(0);
  await page.goto(`/app/companies/${id}`);
  await expect(page.getByTestId("widget-kpi_revenue")).toBeVisible();
  await expect(page.getByTestId("board-alerts")).toHaveCount(0);
});

test("a board shared by a link opens for someone with no account, is counted, and stops when withdrawn (ADR 0090)", async () => {
  const company = await db.query<{ id: string; name: string }>(
    `select c.id, c.name from companies c join accounts a on a.id = c.account_id
      where a.email = $1 and c.name = 'Synthetic Hardware Traders'`,
    [email],
  );
  const id = company.rows[0]?.id ?? "";
  await page.goto(`/app/companies/${id}`);
  await page.getByTestId("share").click();
  await page.getByLabel("The link works for").selectOption("7");
  await page.getByTestId("share-create").click();
  const url = await page.getByTestId("share-url").inputValue();
  expect(url).toMatch(/\/s\/[A-Za-z0-9_-]{43}$/u);
  // What is kept is the link's SHA-256, never the link: the row is found by hashing it.
  const secret = url.split("/s/")[1] ?? "";
  const stored = await db.query<{ n: number }>(
    `select count(*)::int as n from share_links
      where company_id = $1 and token_hash = sha256(convert_to($2, 'UTF8'))`,
    [id, secret],
  );
  expect(stored.rows[0]?.n).toBe(1);

  // Someone with no account and no session opens it.
  const browser = page.context().browser();
  if (browser === null) throw new Error("no browser");
  const stranger = await browser.newContext({ ...devices["Desktop Chrome"] });
  const reader = await stranger.newPage();
  const opened = await reader.goto(url);
  expect(opened?.status()).toBe(200);
  // Never indexed, and its address never sent on as a referrer.
  expect(opened?.headers()["x-robots-tag"]).toContain("noindex");
  expect(opened?.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(reader.getByTestId("share-header")).toContainText(
    "Synthetic Hardware Traders",
  );
  await expect(reader.getByTestId("widget-kpi_revenue")).toBeVisible();
  // Read only: nothing on it opens the owner's chat or changes the board.
  await expect(reader.getByRole("button", { name: "Investigate" })).toHaveCount(0);
  await expect(reader.getByTestId("share")).toHaveCount(0);
  // Every figure still shows how it was computed.
  await reader
    .getByTestId("widget-kpi_revenue")
    .locator("[data-metric-key]")
    .first()
    .click();
  await expect(reader.getByTestId("lineage-panel")).toContainText("Formula");

  // The owner sees it counted, and withdraws it.
  await page.goto(`/app/companies/${id}/manage#shares`);
  const row = page.getByTestId("share-link").first();
  await expect(row.getByTestId("share-views")).toHaveText("1");
  await row.getByTestId("share-withdraw").click();
  await expect(row).toContainText("Withdrawn");
  const gone = await reader.goto(url);
  expect(gone?.status()).toBe(404);
  await expect(reader.getByTestId("share-gone")).toBeVisible();
  await stranger.close();
});

test("presenter notes follow the board on the presenter's own screen, and write nothing (ADR 0087)", async () => {
  const company = await db.query<{ id: string }>(
    `select c.id from companies c join accounts a on a.id = c.account_id
      where a.email = $1 and c.name = 'Synthetic Hardware Traders'`,
    [email],
  );
  await page.goto(`/app/companies/${company.rows[0]?.id ?? ""}`);
  await page.getByTestId("present").click();
  const opened = page.waitForEvent("popup");
  await page.getByTestId("present-notes").click();
  const notes = await opened;
  // What was written about the month on the room's screen, where only the presenter sees it.
  await expect(notes.getByTestId("board-actions")).toContainText(
    "Review the largest movement with the accountant",
  );
  await expect(notes.getByTestId("commentary")).toContainText("The month is led by");
  // Opening the notes takes full screen away from the room's board, as a browser does for any
  // new window; Present stays up, on the window, rather than closing under the presenter.
  await expect(page.getByTestId("present-exit")).toBeVisible();
  // The board steps back a month and the notes go with it; nothing was written for that one.
  await page.getByRole("button", { name: "Earlier month" }).click();
  await expect(notes.getByTestId("notes-no-actions")).toBeVisible();
  await expect(notes.getByTestId("notes-no-commentary")).toBeVisible();
  await notes.close();
  await page.getByTestId("present-exit").click();
  // Reading what was written charges nothing and writes nothing.
  const jobs = await db.query<{ n: number }>(
    `select count(*)::int as n from jobs j join accounts a on a.id = j.account_id
      where a.email = $1 and j.type in ('board_actions', 'commentary')`,
    [email],
  );
  expect(jobs.rows[0]?.n).toBe(2);
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
    "Balance sheet (US GAAP)",
    "Income statement (US GAAP)",
    "Checks",
    "Data",
    "Lineage",
  ]);

  // The name survives the run, the paid dashboard refresh that brings May in, and a reload.
  await page.goto(`/app/companies/${recreated}`);
  await expect(card).toContainText("Turnover");
  // The run brought May onto the board itself; there is no second button to press.
  await expect(page.getByTestId("period-filter")).toHaveValue("2026-05");
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
  // v1 recreate, v2 dashboard (with the setup), v3 rename, v4 dashboard refresh (with May).
  expect(versions.rows.map((r) => r.version)).toEqual([1, 2, 3, 4]);
});

test("files are kept, chosen for the dashboard and opened by nobody unrecorded; every box leads to the chat; the rest has its own page (ADR 0047)", async () => {
  const company = await db.query<{ id: string }>(
    `select c.id from companies c join accounts a on a.id = c.account_id
      where a.email = $1 and c.name = 'Synthetic Hardware Traders'`,
    [email],
  );
  const id = company.rows[0]?.id ?? "";
  await page.goto(`/app/companies/${id}`);
  await expect(page.getByTestId("widget-kpi_revenue")).toBeVisible();

  // The workspace is the board and the chat, and nothing else.
  for (const gone of [
    "Workbooks",
    "Files kept",
    "Activity and charges",
    "Delete company",
  ])
    await expect(page.getByRole("main").getByText(gone, { exact: true })).toHaveCount(0);

  // Every box ends in the chat, not only the KPI cards.
  const boxes = page.locator("section[data-testid^='widget-']");
  const count = await boxes.count();
  expect(count).toBeGreaterThan(8);
  for (let i = 0; i < count; i += 1) {
    const actions = boxes.nth(i).getByTestId("box-actions");
    await expect(actions.getByRole("button", { name: "Investigate" })).toBeVisible();
    await expect(actions.getByRole("button", { name: "Change" })).toBeVisible();
  }
  const question = page.getByLabel("Your question");
  await page
    .getByTestId("widget-trend_revenue")
    .getByRole("button", { name: "Investigate" })
    .click();
  await expect(question).toHaveValue(
    /Why did Revenue from operations, Gross profit and Profit after tax move/u,
  );
  await page.getByTestId("widget-costs").getByRole("button", { name: "Change" }).click();
  await expect(question).toHaveValue('Change the "Costs by month" box: ');
  await expect(
    page.getByTestId("chat-type").getByRole("radio", { name: "Build" }),
  ).toHaveAttribute("aria-checked", "true");
  await question.fill("");
  await page
    .getByTestId("chat-type")
    .getByRole("radio", { name: "Ask", exact: true })
    .click();

  // Untick May's file: May leaves the board, with every figure worked out from it.
  await expect(page.getByTestId("period-filter")).toHaveValue("2026-05");
  await expect(page.getByTestId("dashboard-files")).toContainText("14 of 14");
  await page.getByTestId("dashboard-files").click();
  const drawer = page.getByTestId("files-drawer");
  const may = drawer
    .getByRole("listitem")
    .filter({ hasText: "trial_balance_2026-05.xlsx" });
  await expect(may).toContainText(periodLabel("2026-05"));
  await may.getByRole("checkbox").uncheck();
  await expect(page.getByTestId("dashboard-files")).toContainText("13 of 14");
  await drawer.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("period-filter")).toHaveValue("2026-04");
  expect(
    await page.getByTestId("period-filter").locator("option").allTextContents(),
  ).not.toContain(periodLabel("2026-05"));
  await expect(page.getByTestId("hidden-months")).toContainText(
    `${periodLabel("2026-05")} is left out`,
  );
  // It is a view, and a saved one: nothing was deleted, recomputed or charged.
  const before = await db.query<{ n: number; balance: string }>(
    `select (select count(*)::int from snapshots where company_id = $1) as n,
            (select balance_credits::text from wallets w join accounts a on a.id = w.account_id where a.email = $2) as balance`,
    [id, email],
  );
  await page.reload();
  await expect(page.getByTestId("period-filter")).toHaveValue("2026-04");
  await page
    .getByTestId("hidden-months")
    .getByRole("button", { name: "Choose files" })
    .click();
  await drawer
    .getByRole("listitem")
    .filter({ hasText: "trial_balance_2026-05.xlsx" })
    .getByRole("checkbox")
    .check();
  await drawer.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("period-filter")).toHaveValue("2026-05");
  await expect(page.getByTestId("hidden-months")).toHaveCount(0);
  const after = await db.query<{ n: number; balance: string }>(
    `select (select count(*)::int from snapshots where company_id = $1) as n,
            (select balance_credits::text from wallets w join accounts a on a.id = w.account_id where a.email = $2) as balance`,
    [id, email],
  );
  expect(after.rows[0]).toEqual(before.rows[0]);

  // Everything that is not the board is one press away, on its own page.
  await page.getByTestId("open-manage").click();
  await expect(page).toHaveURL(new RegExp(`/app/companies/${id}/manage$`, "u"));
  await expect(page.getByRole("heading", { name: "Files and settings" })).toBeVisible();
  // Conventions are laid out with what each choice does, and answer as it is changed.
  await expect(page.getByTestId("conventions-fy-example")).toContainText(
    "Your year runs April to March",
  );
  await page.getByLabel("Financial year starts in").selectOption("1");
  await expect(page.getByTestId("conventions-fy-example")).toContainText(
    "Your year runs January to December",
  );
  await page.getByLabel("Numbers shown as").selectOption("millions");
  await expect(page.getByTestId("conventions-number-example")).toContainText(
    "(millions)",
  );
  await page.getByRole("button", { name: "Reset" }).click();
  // ADR 0087: the language commentary is written in and the statutory layout are conventions
  // like the rest — the owner's to change, saved here, and never touched by a run.
  await expect(page.getByLabel("Statutory layout")).toHaveValue("us_gaap");
  await page.getByLabel("Commentary written in").selectOption("es");
  await page.getByLabel("Statutory layout").selectOption("ifrs");
  await page.getByRole("button", { name: "Save conventions" }).click();
  await expect(page.getByText("Saved. It applies to the next run")).toBeVisible();
  const conventions = await db.query<{
    commentary_language: string;
    statutory_format: string;
  }>(`select commentary_language, statutory_format from companies where id = $1`, [id]);
  expect(conventions.rows[0]).toEqual({
    commentary_language: "es",
    statutory_format: "ifrs",
  });
  await page.reload();
  await expect(page.getByLabel("Commentary written in")).toHaveValue("es");
  await page.getByLabel("Commentary written in").selectOption("en");
  await page.getByLabel("Statutory layout").selectOption("us_gaap");
  await page.getByRole("button", { name: "Save conventions" }).click();
  await expect(page.getByText("Saved. It applies to the next run")).toBeVisible();
  await expect(page.getByTestId("company-outputs")).toContainText(".xlsx");
  await expect(page.getByTestId("company-activity")).toContainText("Completed");
  // Kept files are capped, not priced, and the customer sees how much room is used (ADR 0048).
  await expect(page.getByTestId("storage-used")).toContainText(
    "of 2.0 GB used, in 14 files",
  );
  await expect(page.getByTestId("file-promises")).toContainText(
    "No person here can open one",
  );

  // A file comes back to its owner exactly as it went in, and that opening is on the record.
  const upload = await db.query<{ id: string }>(
    `select id from source_uploads where company_id = $1 and file_name = 'trial_balance_2026-05.xlsx' and deleted_at is null`,
    [id],
  );
  // A session alone does not take a file out: raw books need the password confirmed first.
  const uploadUrl = `/api/uploads/${upload.rows[0]?.id ?? ""}`;
  const refused = await page.request.get(uploadUrl);
  expect(refused.status()).toBe(403);
  expect(((await refused.json()) as { error: string }).error).toBe("reauth_required");
  const mayRow = page
    .getByTestId("uploaded-files")
    .getByRole("row", { name: /trial_balance_2026-05\.xlsx/u });
  await mayRow.getByRole("button", { name: "Download" }).click();
  await page.getByLabel("Current password").fill(PASSWORD);
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Confirm" }).click();
  const mine = await saved;
  expect(mine.suggestedFilename()).toBe("trial_balance_2026-05.xlsx");
  expect(
    Buffer.compare(await readFile(await mine.path()), await readFile(tb("2026-05"))),
  ).toBe(0);
  // Asking whether a download is allowed decrypted nothing: one download, one record of it.
  const downloads = await db.query<{ n: number }>(
    `select count(*)::int as n from source_upload_reads where upload_id = $1 and purpose = 'download'`,
    [upload.rows[0]?.id ?? ""],
  );
  expect(downloads.rows[0]?.n).toBe(1);
  await page.reload();
  const row = page
    .getByTestId("uploaded-files")
    .getByRole("row", { name: /trial_balance_2026-05\.xlsx/u });
  await expect(row).toContainText("Last for your download");
  await expect(row).toContainText(periodLabel("2026-05"));
  // Every opening has a reason, and none of them is a person.
  const reads = await db.query<{ purpose: string }>(
    `select distinct purpose from source_upload_reads where upload_id = $1 order by purpose`,
    [upload.rows[0]?.id ?? ""],
  );
  const purposes = reads.rows.map((r) => r.purpose);
  expect(purposes).toEqual(
    expect.arrayContaining(["download", "intake", "pricing", "run"]),
  );
  expect(
    purposes.filter((p) => !["chat", "download", "intake", "pricing", "run"].includes(p)),
  ).toEqual([]);
  // Every file unticked: the board says so and offers the way back. It used to throw.
  await db.query(`update source_uploads set on_dashboard = false where company_id = $1`, [
    id,
  ]);
  await page.goto(`/app/companies/${id}`);
  await expect(page.getByTestId("dashboard-all-hidden")).toContainText(
    "No file is ticked",
  );
  await expect(page.getByTestId("present")).toBeDisabled();
  await expect(page.getByTestId("where-to-act")).toBeDisabled();
  await expect(page.locator("section[data-testid^='widget-']")).toHaveCount(0);
  await page
    .getByTestId("dashboard-all-hidden")
    .getByRole("button", { name: "Choose files" })
    .click();
  await expect(page.getByTestId("files-drawer")).toBeVisible();
  await db.query(`update source_uploads set on_dashboard = true where company_id = $1`, [
    id,
  ]);
  await page.reload();
  await expect(page.getByTestId("widget-kpi_revenue")).toBeVisible();

  // Kept: nothing expires.
  const expiring = await db.query<{ n: number }>(
    `select count(*)::int as n from source_uploads where company_id = $1 and expires_at is not null`,
    [id],
  );
  expect(expiring.rows[0]?.n).toBe(0);
});

test("the ledger map shows every ledger and the line it feeds, and a move stays moved (ADR 0086)", async () => {
  const company = await db.query<{ id: string }>(
    `select c.id from companies c join accounts a on a.id = c.account_id
      where a.email = $1 and c.name = 'Synthetic Hardware Traders'`,
    [email],
  );
  const id = company.rows[0]?.id ?? "";
  const versions = async () =>
    (
      await db.query<{ v: number }>(
        `select max(version)::int as v from blueprints where company_id = $1`,
        [id],
      )
    ).rows[0]?.v ?? 0;

  // Files and settings says how many there are, and opens the map.
  await page.goto(`/app/companies/${id}/manage`);
  await expect(page.getByTestId("ledger-summary")).toContainText("ledgers");
  await page.getByRole("link", { name: "Open the ledger map" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/companies/${id}/ledgers$`, "u"));
  const rows = page.getByTestId("ledger-row");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(5);

  // Move one ledger: it says so, a new version of the company's memory holds it, and a reload
  // still shows it — then it goes back, so the months after this are built as they were. The
  // table sorts by line, so the ledger is found by its name and group, not its position.
  const last = rows.nth((await rows.count()) - 1);
  const name = (await last.locator("p").first().textContent()) ?? "";
  const group = (await last.locator("p").nth(1).textContent()) ?? "";
  const ledger = () =>
    page
      .getByTestId("ledger-row")
      .filter({ hasText: name })
      .filter({ hasText: group })
      .first();
  const original = await ledger().getByRole("combobox").inputValue();
  const before = await versions();
  await ledger().getByRole("combobox").selectOption("OTH_INC_OTHER");
  await expect(ledger()).toContainText("Saved");
  expect(await versions()).toBe(before + 1);
  await page.reload();
  await expect(ledger().getByRole("combobox")).toHaveValue("OTH_INC_OTHER");

  // A change made from an old copy of the map, or to a line that does not exist, is refused.
  const stale = await page.request.patch(`/api/companies/${id}/ledgers`, {
    data: { ledgerKey: "anything", head: "REV", basedOn: before },
    headers: { "idempotency-key": randomUUID() },
  });
  expect(stale.status()).toBe(409);
  const nowhere = await page.request.patch(`/api/companies/${id}/ledgers`, {
    data: { ledgerKey: "anything", head: "NOT_A_LINE", basedOn: before + 1 },
    headers: { "idempotency-key": randomUUID() },
  });
  expect(nowhere.status()).toBe(422);

  await ledger().getByRole("combobox").selectOption(original);
  await expect(ledger()).toContainText("Saved");
  await page.reload();
  await expect(ledger().getByRole("combobox")).toHaveValue(original);
});

test("every email lands somewhere: a finished run, a failed one, a paused one, the list and the reminder (ADR 0086)", async () => {
  // These links opened "not found" until now, and they are the emails that bring people back.
  const setup = await db.query<{ id: string; company_id: string; account_id: string }>(
    `select j.id, j.company_id, j.account_id from jobs j join accounts a on a.id = j.account_id
      where a.email = $1 and j.type = 'company_setup' and j.state = 'completed'
      order by j.created_at limit 1`,
    [email],
  );
  const run = setup.rows[0];
  if (run === undefined) throw new Error("no completed setup run");

  // "Your MIS is ready": what ran, what it charged, and its workbook.
  await page.goto(`/app/jobs/${run.id}`);
  await expect(page.getByTestId("job-page")).toContainText("Completed");
  await expect(page.getByTestId("job-charged")).toContainText("credits");
  await expect(page.getByTestId("job-workbook")).toBeVisible();

  // "A job could not be completed": the message the run screen gave, and the way back.
  const failed = await db.query<{ id: string }>(
    `insert into jobs (account_id, company_id, type, tier, state, failure_class, failure_code,
                       failure_detail, idempotency_key)
     values ($1, $2, 'monthly_refresh', 'professional', 'failed_data', 'data_fault', 'server_run',
             'None of these files held balances for a month.', gen_random_uuid()::text)
     returning id`,
    [run.account_id, run.company_id],
  );
  await page.goto(`/app/jobs/${failed.rows[0]?.id ?? ""}`);
  await expect(page.getByTestId("job-page")).toContainText(
    "None of these files held balances for a month.",
  );
  await expect(page.getByRole("link", { name: "Add the files again" })).toBeVisible();

  // "A quote is waiting": the run screen, holding the quote, ready to carry on.
  const paused = await db.query<{ id: string }>(
    `insert into jobs (account_id, company_id, type, tier, state, price_credits, idempotency_key)
     values ($1, $2, 'monthly_refresh', 'professional', 'needs_quote', 299, gen_random_uuid()::text)
     returning id`,
    [run.account_id, run.company_id],
  );
  const pausedId = paused.rows[0]?.id ?? "";
  await db.query(
    `with q as (insert into quotes (account_id, job_id, reason, credits, expires_at)
                values ($1, $2, 'runtime_cap', 449, now() + interval '1 day') returning id)
     update jobs set quote_id = (select id from q) where id = $2`,
    [run.account_id, pausedId],
  );
  await page.goto(`/app/jobs/${pausedId}`);
  await expect(page).toHaveURL(new RegExp(`/run\\?job=${pausedId}$`, "u"));
  await expect(page.getByTestId("job-quote")).toContainText("449");
  await expect(page.getByRole("button", { name: "Accept and carry on" })).toBeVisible();
  await db.query(`update jobs set state = 'cancelled' where id = any($1)`, [
    [pausedId, failed.rows[0]?.id ?? ""],
  ]);

  // The archive emails' "Open companies" and the reminder's "Refresh now".
  await page.goto("/app/companies");
  await expect(page).toHaveURL(/\/app$/u);
  await page.goto(`/app/companies/${run.company_id}/refresh`);
  await expect(page).toHaveURL(new RegExp(`/app/companies/${run.company_id}/run$`, "u"));

  // A job that is not there is not found, not an error.
  expect((await page.request.get(`/app/jobs/${randomUUID()}`)).status()).toBe(404);
});

test("no Content Security Policy violations anywhere in the flow (SPEC §30)", () => {
  expect(csp).toEqual([]);
});
