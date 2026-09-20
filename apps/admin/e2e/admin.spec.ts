/**
 * Phase 2 admin acceptance (SPEC §26, §34): sign-in with password + TOTP, bank transfer
 * receipt crediting a purchase with a tax invoice, credit adjustment, price book version,
 * accounting export, audit chain verification. Runs against the real local database.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { requestBankTransfer } from "@magicmis/billing";
import { LocalKeyWrapper } from "@magicmis/crypto";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { createAdmin, parseAllowlist } from "../src/server/identity";
import { base32Decode, hotp, timeStep } from "../src/server/totp";

// The app reads .env.local through Next.js; the test reads the same file to share its
// database URL, allowlist and local master key.
const env = Object.fromEntries(
  readFileSync(path.join(import.meta.dirname, "..", ".env.local"), "utf8")
    .split(/\r?\n/u)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
) as Record<string, string>;

const pool = new pg.Pool({ connectionString: env["DATABASE_URL"] ?? "" });
const PASSWORD = "e2e-admin-password-long";
const ADMIN_EMAIL = (env["ADMIN_ALLOWED_EMAILS"] ?? "").split(",")[0]?.trim() ?? "";

let totpSecret = "";

test.beforeAll(async () => {
  // A fresh admin per run: remove the previous run's row (sessions cascade).
  await pool.query(
    `delete from break_glass_grants where admin_user_id in (select id from admin_users where lower(email) = $1)
        or approved_by in (select id from admin_users where lower(email) = $1)`,
    [ADMIN_EMAIL],
  );
  await pool.query(`delete from admin_users where lower(email) = $1`, [ADMIN_EMAIL]);
  const created = await createAdmin(
    pool,
    LocalKeyWrapper.fromBase64(env["LOCAL_MASTER_KEY"] ?? ""),
    {
      email: ADMIN_EMAIL,
      password: PASSWORD,
      allowlist: parseAllowlist(env["ADMIN_ALLOWED_EMAILS"] ?? ""),
      issuer: "E2E",
    },
  );
  totpSecret = created.totpSecret;
});

test.afterAll(async () => {
  await pool.end();
});

async function signIn(page: Page): Promise<void> {
  // Never reuse a step: wait into a fresh 30 s window.
  await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page
    .getByLabel("Authenticator code")
    .fill(hotp(base32Decode(totpSecret), timeStep(new Date())));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
}

test("console refuses anonymous visitors and wrong codes", async ({ page, request }) => {
  await page.goto("/accounts");
  await expect(page).toHaveURL(/\/login$/u);
  expect((await request.get("/exports/invoice_register?month=2026-09")).status()).toBe(
    401,
  );

  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Authenticator code").fill("000000");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Email, password or code is incorrect.")).toBeVisible();
});

test("bank transfer receipt credits the account; adjustment, price version, export and audit work", async ({
  page,
}) => {
  // A customer with a pending bank transfer.
  const account = await pool.query<{ id: string }>(
    `insert into accounts (auth_user_id, email, business_name, billing_address, state_code, billing_country)
     values (gen_random_uuid(), $1, 'E2E Admin Customer', '{"line1":"1 Road","city":"Pune","country":"IN","postalCode":"411001","stateCode":"27"}', '27', 'IN')
     returning id`,
    [`e2e-admin-${randomUUID().slice(0, 8)}@example.test`],
  );
  const accountId = account.rows[0]?.id ?? "";
  const pack = await pool.query<{ id: string }>(
    `select p.id from credit_packs p
       join credit_pack_prices pp on pp.pack_id = p.id and pp.currency = 'INR'
      where p.active and pp.price_minor_ex_tax = 2500000 limit 1`,
  );
  const { proforma } = await requestBankTransfer(pool, {
    accountId,
    packId: pack.rows[0]?.id ?? "",
    idempotencyKey: randomUUID(),
  });

  await signIn(page);

  await page.getByRole("link", { name: "Bank transfers" }).click();
  const row = page.getByRole("row", {
    name: new RegExp(proforma?.number.replaceAll("/", "\\/") ?? "none", "u"),
  });
  await row
    .getByPlaceholder("UTR")
    .fill(`E2EUTR${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`);
  await row.getByRole("button", { name: "Confirm receipt" }).click();
  await expect(page.getByRole("status")).toContainText(
    /Credited; tax invoice INV\/\d\d-\d\d\/\d{6} issued/u,
  );

  await page.goto(`/accounts/${accountId}`);
  await expect(page.getByText("27500").first()).toBeVisible();
  await page.getByPlaceholder("+500 or -200").fill("-500");
  await page
    .getByPlaceholder("Reason (required, audited)")
    .fill("E2E goodwill reversal test");
  await page.getByRole("button", { name: "Adjust credits" }).click();
  await expect(page.getByRole("status")).toContainText("Adjustment applied");
  await expect(page.getByText("27000").first()).toBeVisible();

  await page.getByRole("link", { name: "Price book" }).click();
  await page.locator("select[name=actionKey]").selectOption("chat_edit");
  await page.getByLabel("Base credits").fill("21");
  // SPEC §26: the margin impact on the last 30 days shows before anything is published.
  await page.getByRole("button", { name: "Preview impact" }).click();
  await expect(
    page.getByText("Margin impact preview — chat_edit, last 30 days"),
  ).toBeVisible();
  await expect(page.getByTestId("price-impact")).toContainText(
    "Credits captured — proposed",
  );
  await expect(page.getByLabel("Base credits")).toHaveValue("21");
  await page.getByLabel("Effective from (IST; blank = now)").fill("2099-01-01T00:00");
  await page.getByRole("button", { name: "Publish version" }).click();
  await expect(page.getByRole("status")).toContainText(
    /Published chat_edit version \d+/u,
  );

  const month = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
  const csv = await page.request.get(`/exports/invoice_register?month=${month}`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain(proforma?.number ?? "missing");

  await page.goto("/audit?verify=1");
  await expect(page.getByText(/Chain verified/u)).toBeVisible();
  await expect(page.getByText("billing.bank_transfer_received").first()).toBeVisible();
  await expect(page.getByText("wallet.admin_adjust").first()).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/u);
});

test("margin dashboard flags a seeded over-ratio action; break-glass, jobs and prompts screens work", async ({
  page,
}) => {
  test.setTimeout(180_000);
  // Seed an account with a commentary job over its max AI cost ratio: 100 credits captured, ₹30 AI cost.
  const email = `${randomUUID()}@example.test`;
  const acct = await pool.query<{ id: string }>(
    `insert into accounts (auth_user_id, email, business_name, state_code, billing_country) values (gen_random_uuid(), $1, 'Margin Seed Co', '27', 'IN') returning id`,
    [email],
  );
  const accountId = acct.rows[0]?.id ?? "";
  await pool.query(`insert into wallets (account_id) values ($1)`, [accountId]);
  const company = await pool.query<{ id: string }>(
    `insert into companies (account_id, name) values ($1, 'Seed Traders') returning id`,
    [accountId],
  );
  const job = await pool.query<{ id: string }>(
    `insert into jobs (account_id, company_id, type, state, idempotency_key, captured_credits, actual_ai_cost_paise,
                       stage_checkpoints)
     values ($1, $2, 'commentary', 'completed', $3, 100, 3000,
             '{"state_history":[{"from":"reserved","state":"commentary_queued","at":"2026-09-13T10:00:00Z"}]}') returning id`,
    [accountId, company.rows[0]?.id, randomUUID()],
  );

  await signIn(page);
  await page.goto(`/margin?days=1&account=${accountId}`);
  await expect(page.getByTestId("margin-flags")).toContainText("commentary");
  await expect(page.getByTestId("margin-action-commentary")).toContainText("over");
  await expect(page.getByTestId("gross-margin")).toContainText("Gross margin");

  await page.goto(`/jobs/${job.rows[0]?.id ?? ""}`);
  await expect(page.getByTestId("job-timeline")).toContainText(
    "reserved → commentary_queued",
  );

  // The owner's business page (ADR 0055). The account seeded above has a company, a completed
  // commentary job and an ai_calls row, so every panel has something real to report.
  await page.goto("/business");
  await expect(page.getByRole("heading", { name: "Business" })).toBeVisible();
  await expect(page.getByTestId("business-growth")).toContainText("Activated");
  await expect(page.getByTestId("business-companies")).toContainText(
    "Ran in the last 30 days",
  );
  // Cash collected and revenue recognised are different questions and both are answered.
  const revenue = page.getByTestId("business-revenue");
  await expect(revenue).toContainText("Cash collected");
  await expect(revenue).toContainText("Revenue recognised");
  await expect(revenue).toContainText("Deferred revenue");
  // The contracted fee and the consumption run rate are never merged into one "MRR".
  const recurring = page.getByTestId("business-recurring");
  await expect(recurring).toContainText("Committed monthly");
  await expect(recurring).toContainText("Consumption run rate");
  await expect(recurring).not.toContainText(/\bMRR\b/u);
  await expect(page.getByTestId("business-ai")).toContainText("Share of revenue");

  await page.goto("/prompts");
  await expect(page.getByRole("heading", { name: "Prompts and evals" })).toBeVisible();
  await page.goto("/models");
  await expect(page.getByRole("heading", { name: "Tier routing" })).toBeVisible();

  await page.goto(`/accounts/${accountId}`);
  await page
    .getByLabel("Reason (20 to 500 characters)")
    .fill("E2E check of the break-glass flow for support");
  await page.getByLabel("Company").selectOption({ label: "Seed Traders" });
  // R-53 step-up: a fresh code, never the one used to sign in.
  await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
  await page
    .locator("form", { has: page.getByRole("button", { name: "Grant access" }) })
    .getByLabel("Authenticator code")
    .fill(hotp(base32Decode(totpSecret), timeStep(new Date())));
  await page.getByRole("button", { name: "Grant access" }).click();
  await expect(page.getByTestId("break-glass-grant")).toContainText(
    "E2E check of the break-glass flow",
  );
  const notice = await pool.query(
    `select 1 from notifications where account_id = $1 and type = 'security.break_glass'`,
    [accountId],
  );
  expect(notice.rowCount).toBe(1);
  await page.getByRole("link", { name: "View Seed Traders" }).click();
  await expect(page.getByRole("heading", { name: "Break-glass view" })).toBeVisible();
  const viewed = await pool.query(
    `select 1 from audit_log where action = 'admin.break_glass_viewed' and target_id = $1`,
    [company.rows[0]?.id],
  );
  expect(viewed.rowCount).toBe(1);
});
