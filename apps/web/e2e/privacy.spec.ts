/**
 * Phase 9 compliance surfaces (SPEC §10, §31): a data export is requested, built by the worker task,
 * and downloaded by its owner; the account is then deleted behind re-authentication and cannot sign
 * in again.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import {
  createVerifiedAccountWithTotp,
  nextTotpWindow,
  PASSWORD,
  totpCode,
  uniqueEmail,
} from "./helpers";

const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
// Same development-only key and directory the web server uses (playwright.config.ts, runtime.ts).
const MASTER_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
const OUTPUT_ROOT = path.resolve(process.cwd(), ".data", "outputs");

const TSX = path.resolve(process.cwd(), "..", "worker", "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");

/** One tick of the worker export task (support/run-exports.ts). */
function runExportTick(): { built: number } {
  const out = execFileSync(
    TSX,
    ["--conditions=react-server", path.join("e2e", "support", "run-exports.ts"), LOCAL_DB, MASTER_KEY, OUTPUT_ROOT],
    { encoding: "utf8", shell: process.platform === "win32" },
  );
  return JSON.parse(out) as { built: number };
}

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

let page: Page;
let db: pg.Pool;
let email: string;
let secret: string;

test.beforeAll(async ({ browser }) => {
  db = new pg.Pool({ connectionString: LOCAL_DB, max: 2 });
  page = await browser.newPage();
  email = uniqueEmail();
  secret = await createVerifiedAccountWithTotp(page, email);
});

test.afterAll(async () => {
  await page.close();
  await db.end();
});

test("the owner requests a data export and downloads it once the worker has built it", async () => {
  await page.goto("/settings/privacy");
  await page.getByRole("button", { name: "Request export" }).click();
  await expect(page.getByText(/Your export is being prepared/u)).toBeVisible();
  await expect(page.getByTestId("exports")).toContainText("Being prepared");

  const result = runExportTick();
  expect(result.built).toBeGreaterThanOrEqual(1);

  await page.reload();
  await expect(page.getByTestId("exports")).toContainText("Ready");
  const href = await page.getByRole("link", { name: "Download" }).first().getAttribute("href");
  const response = await page.request.get(href ?? "");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const body = (await response.json()) as {
    profile: { email: string };
    consents: { document: string }[];
  };
  expect(body.profile.email).toBe(email);
  expect(body.consents.map((c) => c.document)).toEqual(
    expect.arrayContaining(["terms", "privacy"]),
  );
});

test("deleting the account needs re-authentication and the email, then signs out for good", async () => {
  await page.goto("/settings/privacy");
  await page.getByRole("button", { name: "Delete account" }).click();
  await nextTotpWindow();
  await page.getByLabel("Current password").fill(PASSWORD);
  await page.getByLabel("Authenticator code").fill(totpCode(secret));
  await page.getByRole("button", { name: "Confirm" }).click();

  await page.getByLabel(/to confirm/u).fill("someone-else@example.test");
  await page.getByRole("button", { name: "Permanently delete my account" }).click();
  await expect(page.getByText("Does not match")).toBeVisible();

  await page.getByLabel(/to confirm/u).fill(email);
  await page.getByRole("button", { name: "Permanently delete my account" }).click();
  await expect(page).toHaveURL(/\/signed-out\?reason=deleted/u);
  await expect(page.getByTestId("signed-out-reason")).toContainText("deleted");

  const account = await db.query<{ status: string; purge_after: Date | null }>(
    `select status, purge_after from accounts where lower(email) = lower($1)`,
    [email],
  );
  expect(account.rows[0]?.status).toBe("deleted");
  expect(account.rows[0]?.purge_after).not.toBeNull();

  // The session is gone and the login no longer exists.
  expect((await page.request.get("/api/account/export")).status()).toBe(401);
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).not.toHaveURL(/\/app/u);
});
