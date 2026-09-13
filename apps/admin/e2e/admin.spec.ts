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
    `insert into accounts (auth_user_id, email, business_name, billing_address, state_code)
     values (gen_random_uuid(), $1, 'E2E Admin Customer', '{"line1":"1 Road","city":"Pune","pincode":"411001","stateCode":"27"}', '27')
     returning id`,
    [`e2e-admin-${randomUUID().slice(0, 8)}@example.test`],
  );
  const accountId = account.rows[0]?.id ?? "";
  const pack = await pool.query<{ id: string }>(
    `select id from credit_packs where active and price_paise_ex_gst = 2500000 limit 1`,
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
  await expect(page.getByRole("status")).toContainText("Chain verified");
  await expect(page.getByText("billing.bank_transfer_received").first()).toBeVisible();
  await expect(page.getByText("wallet.admin_adjust").first()).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/u);
});
