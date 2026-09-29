/**
 * Welcome credits, end to end (ADR 0068), and the line that says the product can be wrong
 * (ADR 0070).
 *
 * A new account is granted its welcome credits at its first sign-in, sees them on its first
 * screen, and runs its first company on them without buying anything: every action is still held
 * and captured at its price, from the welcome lot. The site states the offer from its live
 * configuration. A throwaway address gets nothing, and a fourth new account from one network waits
 * until it signs in from elsewhere; both accounts work as normal throughout.
 *
 * Every request in the suite comes from one address, so each test here signs up from its own
 * documentation-range address; otherwise which account got the credits would depend on the order
 * the suite ran in.
 */

import { randomUUID } from "node:crypto";

import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";

import {
  createVerifiedAccount,
  LOCAL_DB,
  signIn,
  uniqueEmail,
  watchCspViolations,
} from "./helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

let db: pg.Pool;
test.beforeAll(() => {
  db = new pg.Pool({ connectionString: LOCAL_DB, max: 2 });
});
test.afterAll(async () => {
  await db.end();
});

const octet = () => Math.floor(Math.random() * 250) + 1;
const freshAddress = () => `198.51.${String(octet())}.${String(octet())}`;

/** A browser whose every request says it comes from `ip`, as the platform's edge would. */
async function pageFrom(browser: Browser, ip: string): Promise<Page> {
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-vercel-forwarded-for": ip },
  });
  return context.newPage();
}

async function decision(email: string) {
  const r = await db.query<{ outcome: string; reason: string | null; credits: string }>(
    `select w.outcome, w.reason, w.credits::text from welcome_credits w
       join accounts a on a.id = w.account_id where a.email = $1`,
    [email],
  );
  return r.rows[0];
}

async function wallet(email: string) {
  const r = await db.query<{ balance: string; held: string }>(
    `select w.balance_credits::text as balance, w.held_credits::text as held
       from wallets w join accounts a on a.id = w.account_id where a.email = $1`,
    [email],
  );
  return r.rows[0];
}

test("a new account starts with its welcome credits and runs its first company on them", async ({
  browser,
}) => {
  const page = await pageFrom(browser, freshAddress());
  const csp = watchCspViolations(page);
  const email = uniqueEmail();
  await createVerifiedAccount(page, email);

  // Decided at the first sign-in, recorded once, and said on the very first screen.
  expect(await decision(email)).toEqual({
    outcome: "granted",
    reason: null,
    credits: "1500",
  });
  const note = page.getByTestId("welcome-credits");
  await expect(note).toContainText("1,500 welcome credits are in your wallet.");
  await expect(note).toContainText("Enough to set this company up on your own books");

  // The Wallet shows the lot for what it is: added, not bought.
  await page.goto("/wallet");
  await expect(page.getByTestId("wallet-balance")).toContainText("1,500");
  await expect(page.getByText("Welcome credits", { exact: true })).toBeVisible();

  // A first run, paid for from the welcome lot with no purchase at all.
  const consent = await page.request.post("/api/account/consents", {
    data: { document: "processing" },
    headers: { "idempotency-key": randomUUID() },
  });
  expect(consent.ok()).toBe(true);
  await page.goto("/app");
  await page.getByLabel("Company name").fill("Welcome Traders");
  await page.getByRole("button", { name: "Add company" }).click();
  await expect(page).toHaveURL(/\/app\/companies\/[0-9a-f-]+$/u);
  await page.getByLabel("Choose files").setInputFiles({
    name: "trial balance March 2026.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Account,Debit,Credit\nCash at bank,1500,\nSales,,2500\nRent,1000,\n",
    ),
  });
  await expect(page.getByTestId("job-run")).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId("job-run").click();
  await expect(page.getByTestId("job-done")).toBeVisible({ timeout: 180_000 });

  const charged = await db.query<{ captured: string }>(
    `select coalesce(sum(j.captured_credits), 0)::text as captured
       from jobs j join accounts a on a.id = j.account_id where a.email = $1`,
    [email],
  );
  const captured = BigInt(charged.rows[0]?.captured ?? "0");
  // The run was charged its price-book price, like any other run.
  expect(captured).toBeGreaterThan(0n);
  expect(await wallet(email)).toEqual({
    balance: (1500n - captured).toString(),
    held: "0",
  });
  // Every credit it spent came out of the welcome lot, and nothing was bought.
  const spentFrom = await db.query<{ source: string }>(
    `select distinct lot.source from credit_ledger l
       join credit_lots lot on lot.id = l.lot_id
       join accounts a on a.id = l.account_id
      where a.email = $1 and l.entry_type = 'capture'`,
    [email],
  );
  expect(spentFrom.rows).toEqual([{ source: "welcome" }]);
  const bought = await db.query(
    `select 1 from purchases p join accounts a on a.id = p.account_id where a.email = $1`,
    [email],
  );
  expect(bought.rowCount).toBe(0);

  // ADR 0070: the board and the chat each say, once and quietly, that the product can be wrong.
  await page.reload();
  const board = page.getByTestId("stage").getByTestId("mistakes-note");
  await expect(board).toContainText("can make mistakes. Open any figure");
  await expect(page.getByTestId("assistant").getByTestId("mistakes-note")).toContainText(
    "Check anything important against your books.",
  );
  // Not while presenting: there the accountant is the reviewer, speaking to their client.
  await page.getByTestId("present").click();
  await expect(page.getByTestId("present-exit")).toBeVisible();
  await expect(page.getByTestId("stage").getByTestId("mistakes-note")).toHaveCount(0);
  await page.getByTestId("present-exit").click();

  // ADR 0069: the next month on the same structure asks the model nothing — including about a
  // ledger nothing could place at setup, which is settled as Unmapped rather than asked again.
  // (Where ledger mapping is activated the setup above asked about it; CI activates nothing.)
  const account = await db.query<{ id: string }>(
    `select id from accounts where email = $1`,
    [email],
  );
  const accountId = account.rows[0]?.id ?? "";
  const { grantCredits } = await import("@magicmis/wallet");
  await grantCredits(db, {
    accountId,
    credits: 1000n,
    source: "admin_grant",
    idempotencyKey: randomUUID(),
  });
  const calls = async () =>
    (
      await db.query<{ n: number }>(
        `select count(*)::int as n from ai_calls where account_id = $1`,
        [accountId],
      )
    ).rows[0]?.n ?? -1;
  const before = await calls();
  await page.goto("/app");
  await page.getByRole("link", { name: "Add a file" }).click();
  await page.getByLabel("Choose files").setInputFiles({
    name: "trial balance April 2026.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Account,Debit,Credit\nCash at bank,1800,\nSales,,2900\nRent,1100,\n",
    ),
  });
  await expect(page.getByTestId("job-run")).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId("job-run").click();
  await expect(page.getByTestId("job-done")).toBeVisible({ timeout: 180_000 });
  expect(await calls()).toBe(before);

  expect(csp).toEqual([]);
  await page.context().close();
});

test("the public site states the offer from its live configuration", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("welcome-line")).toContainText(
    "Start with 1,500 free credits, enough to set up your first company",
  );
  await page.goto("/pricing");
  await expect(page.getByTestId("welcome-band")).toContainText("1,500 free credits");
  // The answer sits in a closed question until the reader opens it.
  await page.getByText("Is there a free trial?").click();
  await expect(
    page.getByText("New accounts start with 1,500 free credits"),
  ).toBeVisible();
  await page.goto("/sign-up");
  await expect(page.getByText("Start with 1,500 free credits")).toBeVisible();
  const llms = await page.request.get("/llms-full.txt");
  expect(await llms.text()).toContain("New accounts start with 1,500 free credits");
  // Nothing on the site still says there is no trial.
  for (const path of ["/", "/pricing", "/for-accountants", "/legal/terms"]) {
    await page.goto(path);
    await expect(page.locator("main")).not.toContainText(/no free tier or trial/iu);
  }
});

test("a throwaway address gets no welcome credits, and the account works as normal", async ({
  browser,
}) => {
  const page = await pageFrom(browser, freshAddress());
  const email = `e2e-${randomUUID().slice(0, 8)}@mailinator.com`;
  await createVerifiedAccount(page, email);
  expect(await decision(email)).toEqual({
    outcome: "withheld",
    reason: "disposable_email",
    credits: "0",
  });
  await expect(page.getByTestId("welcome-credits")).toHaveCount(0);
  // Told why, beside the offer it did not get (ADR 0072).
  await expect(page.getByTestId("welcome-status")).toContainText(
    "throwaway email service",
  );
  await expect(page.getByText("Actions are paid from prepaid credits.")).toBeVisible();
  expect(await wallet(email)).toEqual({ balance: "0", held: "0" });
  await page.context().close();
});

test("a fourth new account from one network waits, and is granted at a sign-in from elsewhere", async ({
  browser,
}) => {
  const ip = freshAddress();
  const outcomes: (string | undefined)[] = [];
  let fourth = "";
  for (let i = 0; i < 4; i++) {
    const page = await pageFrom(browser, ip);
    const email = uniqueEmail();
    await createVerifiedAccount(page, email);
    outcomes.push((await decision(email))?.outcome);
    if (i === 3) {
      // Deferred, not refused: the account is in and works, with nothing decided yet.
      fourth = email;
      await expect(page).toHaveURL(/\/app$/u);
      await expect(page.getByTestId("welcome-credits")).toHaveCount(0);
      // Told, not left to wonder (ADR 0072).
      await expect(page.getByTestId("welcome-status")).toContainText(
        "not in your wallet yet",
      );
    }
    await page.context().close();
  }
  expect(outcomes).toEqual(["granted", "granted", "granted", undefined]);

  // The same customer signs in later from another network, and the offer reaches them.
  const later = await pageFrom(browser, freshAddress());
  await signIn(later, fourth);
  expect(await decision(fourth)).toEqual({
    outcome: "granted",
    reason: null,
    credits: "1500",
  });
  await expect(later.getByTestId("welcome-credits")).toContainText(
    "1,500 welcome credits",
  );
  await later.context().close();
});
