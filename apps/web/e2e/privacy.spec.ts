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

const TSX = path.resolve(
  process.cwd(),
  "..",
  "worker",
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsx.cmd" : "tsx",
);

/** One tick of the worker export task (support/run-exports.ts). */
function runExportTick(): { built: number } {
  const out = execFileSync(
    TSX,
    [
      "--conditions=react-server",
      path.join("e2e", "support", "run-exports.ts"),
      LOCAL_DB,
      MASTER_KEY,
      OUTPUT_ROOT,
    ],
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
  const href = await page
    .getByRole("link", { name: "Download" })
    .first()
    .getAttribute("href");
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

test("another account's resources are unreachable through every id-scoped endpoint (SPEC §30)", async () => {
  // A second tenant with a company, job, output, chat thread and message, export and invoice.
  const other = await db.query<{ id: string }>(
    `insert into accounts (auth_user_id, email, business_name, state_code) values (gen_random_uuid(), $1, 'Other Tenant Co', '27') returning id`,
    [uniqueEmail()],
  );
  const otherId = other.rows[0]?.id ?? "";
  const one = async (sql: string, params: unknown[]) =>
    (await db.query<{ id: string }>(sql, params)).rows[0]?.id ?? "";
  const company = await one(
    `insert into companies (account_id, name) values ($1, 'Hidden Traders') returning id`,
    [otherId],
  );
  const job = await one(
    `insert into jobs (account_id, company_id, type, state, idempotency_key) values ($1, $2, 'monthly_refresh', 'classifying', gen_random_uuid()::text) returning id`,
    [otherId, company],
  );
  const output = await one(
    `insert into outputs (account_id, company_id, job_id, type, storage_path, byte_size) values ($1, $2, $3, 'excel', 'x/y.xlsx', 10) returning id`,
    [otherId, company, job],
  );
  const thread = await one(
    `insert into chat_threads (account_id, company_id) values ($1, $2) returning id`,
    [otherId, company],
  );
  const message = await one(
    `insert into chat_messages (thread_id, account_id, role, message_type, content, tier, price_credits, credits_charged, state)
     values ($1, $2, 'user', 'edit', '\\x', 'professional', 0, 0, 'completed') returning id`,
    [thread, otherId],
  );
  const dataExport = await one(
    `insert into data_exports (account_id, status) values ($1, 'queued') returning id`,
    [otherId],
  );
  const invoice = await one(`select id from invoices where account_id <> $1 limit 1`, [
    (
      await db.query<{ id: string }>(
        `select id from accounts where lower(email) = lower($1)`,
        [email],
      )
    ).rows[0]?.id ?? "",
  ]);

  const json = {
    "content-type": "application/json",
    "idempotency-key": "cross-tenant-probe",
  };
  const probes: [string, string, object | undefined][] = [
    ["GET", `/api/companies/${company}`, undefined],
    ["DELETE", `/api/companies/${company}`, { confirmName: "Hidden Traders" }],
    ["GET", `/api/companies/${company}/session`, undefined],
    ["GET", `/api/companies/${company}/dashboard`, undefined],
    ["POST", `/api/companies/${company}/dashboard`, { operations: [] }],
    ["GET", `/api/companies/${company}/chat`, undefined],
    ["POST", `/api/companies/${company}/template`, { undoTo: 1 }],
    ["POST", `/api/companies/${company}/restore`, {}],
    ["GET", `/api/jobs/${job}`, undefined],
    ["POST", `/api/jobs/${job}/confirm`, {}],
    ["POST", `/api/jobs/${job}/cancel`, {}],
    ["POST", `/api/jobs/${job}/ai/sheet_classification`, { sheets: [] }],
    ["GET", `/api/jobs/${job}/commentary`, undefined],
    ["GET", `/api/outputs/${output}`, undefined],
    ["GET", `/api/chat/threads/${thread}`, undefined],
    ["POST", `/api/chat/messages/${message}/apply`, {}],
    ["GET", `/api/account/export/${dataExport}`, undefined],
    ...(invoice === ""
      ? []
      : [
          ["GET", `/api/invoices/${invoice}/pdf`, undefined] as [
            string,
            string,
            undefined,
          ],
        ]),
  ];
  for (const [method, url, body] of probes) {
    const response = await page.request.fetch(url, {
      method,
      headers: json,
      ...(body === undefined ? {} : { data: body }),
    });
    const text = await response.text();
    expect(response.status(), `${method} ${url}`).toBeGreaterThanOrEqual(400);
    expect(response.status(), `${method} ${url}`).not.toBe(500);
    expect(text, `${method} ${url}`).not.toContain("Hidden Traders");
  }
  // Nothing about the other tenant changed.
  const after = await db.query<{ deleted_at: Date | null; state: string }>(
    `select c.deleted_at, j.state from companies c join jobs j on j.company_id = c.id where c.id = $1`,
    [company],
  );
  expect(after.rows[0]).toEqual({ deleted_at: null, state: "classifying" });
});

test("oversize and malformed payloads are refused before any work (SPEC §7, §30)", async () => {
  const headers = {
    "content-type": "application/json",
    "idempotency-key": `oversize-${Date.now().toString()}`,
  };
  const huge = "x".repeat(6 * 1024 * 1024);
  for (const url of [
    "/api/chat/messages",
    "/api/account/consents",
    "/api/account/delete",
  ]) {
    const response = await page.request.post(url, {
      headers,
      data: `{"text":"${huge}"}`,
    });
    expect(response.status(), url).toBeGreaterThanOrEqual(400);
    expect(response.status(), url).toBeLessThan(500);
  }
  const malformed = await page.request.post("/api/account/consents", {
    headers,
    data: Buffer.from("{not json"),
  });
  expect(malformed.status()).toBe(400);
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
