/**
 * Payroll by designation, on the board, by asking (ADR 0056, ADR 0085).
 *
 * ADR 0056 added the breakdown box so that payroll by designation — computed from the pay sheet
 * every month — could finally be shown. Every list of what a board may hold was the MIS library
 * alone, so the box was refused wherever it was asked for. This puts it there the way a customer
 * would: a services business with its pay sheets, set up, then one message.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { grantCredits } from "@magicmis/wallet";
import pg from "pg";

import { FIXTURES_OUT } from "./fixtures-setup";
import {
  createVerifiedAccount,
  LOCAL_DB,
  uniqueEmail,
  watchCspViolations,
} from "./helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const MONTHS = [
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
const services = (file: string) => path.join(FIXTURES_OUT, "services", "clean", file);

let page: Page;
let db: pg.Pool;
let csp: string[] = [];
/** Anything the page throws: a box that crashes the board fails here, by name. */
const crashes: string[] = [];
let activated: string[] = [];

test.beforeAll(async ({ browser }) => {
  db = new pg.Pool({ connectionString: LOCAL_DB, max: 2 });
  // The clean stack activates nothing (R-28); this file drives the fake model's dashboard change.
  const r = await db.query<{ id: string }>(
    `update tier_routing set prompt_version = 3
      where stage = 'chat_edit' and prompt_version is null returning id`,
  );
  activated = r.rows.map((x) => x.id);

  // Indian books from India, so the company opens on an April year in rupees (ADR 0084).
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-vercel-ip-country": "IN" },
  });
  page = await context.newPage();
  csp = watchCspViolations(page);
  page.on("pageerror", (e) =>
    crashes.push(`${e.message}
${e.stack ?? ""}`),
  );
  const email = uniqueEmail();
  await createVerifiedAccount(page, email);
  // Files are read only once the processing notice is accepted, as on the setup screen.
  const consent = await page.request.post("/api/account/consents", {
    data: { document: "processing" },
    headers: { "idempotency-key": randomUUID() },
  });
  expect(consent.ok()).toBe(true);
  const account = await db.query<{ id: string }>(
    `select id from accounts where email = $1`,
    [email],
  );
  await grantCredits(db, {
    accountId: account.rows[0]?.id ?? "",
    credits: 5_000n,
    source: "admin_grant",
    idempotencyKey: randomUUID(),
  });
});

test.afterAll(async () => {
  expect(crashes).toEqual([]);
  expect(csp).toEqual([]);
  await db.query(`update tier_routing set prompt_version = null where id = any($1)`, [
    activated,
  ]);
  await page.context().close();
  await db.end();
});

test("a services company's payroll by designation goes on the board when asked for (ADR 0085)", async () => {
  await page.goto("/app");
  await page.getByLabel("Company name").fill("Lakeside Advisory Services");
  await page.getByRole("button", { name: "Add company" }).click();
  await page.waitForURL(/\/app\/companies\/[0-9a-f-]+$/u);
  const companyId = page.url().split("/").pop() ?? "";

  await page
    .getByLabel("Choose files", { exact: true })
    .setInputFiles([
      ...MONTHS.map((m) => services(`trial_balance_${m}.xlsx`)),
      ...MONTHS.map((m) => services(`pay_sheet_${m}.csv`)),
    ]);
  await page.getByTestId("job-run").click();
  await page.getByTestId("job-done").waitFor({ timeout: 240_000 });

  await page.goto(`/app/companies/${companyId}?chat=open`);
  const question = page.getByLabel("Your question");
  await question.fill("Add a chart of payroll cost by designation");
  await expect(page.getByTestId("chat-building")).toContainText(
    "This will update the dashboard",
  );
  await page.getByTestId("chat-send").click();
  await expect(page.getByTestId("chat-edit").last()).toContainText(
    "Done. It is on the dashboard",
    { timeout: 60_000 },
  );

  // The box is there, named for what it shows, and split by the designations on the pay sheet
  // rather than saying it has nothing to split.
  const box = page.locator("[data-testid^='widget-payroll_']");
  await expect(box).toContainText("Payroll cost by designation");
  await expect(box).not.toContainText("Nothing to split");
  await expect(box).not.toContainText("needs a figure");
});
