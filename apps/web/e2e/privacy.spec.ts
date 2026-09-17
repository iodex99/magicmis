/**
 * Phase 9 compliance surfaces (SPEC §10, §31): a data export is requested, built by the worker task,
 * and downloaded by its owner; the account is then deleted behind re-authentication and cannot sign
 * in again.
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { createVerifiedAccount, PASSWORD, uniqueEmail } from "./helpers";

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

test.beforeAll(async ({ browser }) => {
  db = new pg.Pool({ connectionString: LOCAL_DB, max: 2 });
  // This file probes every id-scoped endpoint in a tight loop from one IP, which is what
  // the per-IP limit is for. Start it from a clean count so the limit refuses tenancy
  // violations here, not the suite's own volume.
  await db.query(`delete from rate_limit_counters`);
  page = await browser.newPage();
  email = uniqueEmail();
  await createVerifiedAccount(page, email);
});

test.afterAll(async () => {
  await page.close();
  await db.end();
});

async function reauthenticate(): Promise<void> {
  await page.getByLabel("Current password").fill(PASSWORD);
  await page.getByRole("button", { name: "Confirm" }).click();
}

test("the owner requests a data export and downloads it once the worker has built it", async () => {
  // SPEC §8: exporting is a re-authentication action, on the server as well as in the UI.
  const refused = await page.request.post("/api/account/export", {
    headers: { "idempotency-key": randomUUID() },
    data: {},
  });
  expect(refused.status()).toBe(403);
  expect(((await refused.json()) as { error: string }).error).toBe("reauth_required");

  await page.goto("/settings/privacy");
  await page.getByRole("button", { name: "Request export" }).click();
  await reauthenticate();
  await expect(page.getByText(/Your export is being prepared/u)).toBeVisible();
  await expect(page.getByTestId("exports")).toContainText("Being prepared");

  const result = runExportTick();
  expect(result.built).toBeGreaterThanOrEqual(1);

  await page.reload();
  await expect(page.getByTestId("exports")).toContainText("Ready");
  await page.getByRole("button", { name: "Download" }).first().click();
  const download = page.waitForEvent("download");
  await reauthenticate();
  const file = await (await download).path();
  const body = JSON.parse(readFileSync(file, "utf8")) as {
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
    `insert into accounts (auth_user_id, email, business_name, state_code, billing_country) values (gen_random_uuid(), $1, 'Other Tenant Co', '27', 'IN') returning id`,
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
  const upload = await one(
    `insert into source_uploads (account_id, company_id, file_name, byte_size, chunk_count, expires_at)
     values ($1, $2, 'hidden.csv', 10, 1, now() + interval '1 day') returning id`,
    [otherId, company],
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

  const size = {
    files: 1,
    sheets: 1,
    columns: 6,
    rows: 80,
    distinctLedgerValues: 40,
    referenceMisSheets: 0,
  };
  // Every probe carries a body that passes validation, so a refusal proves ownership was checked
  // (a 422 would only prove the body was wrong). Route templates are listed to guard coverage.
  const probes: { route: string; method: string; url: string; body?: object }[] = [
    { route: "/api/companies/[id]", method: "GET", url: `/api/companies/${company}` },
    {
      route: "/api/companies/[id]",
      method: "DELETE",
      url: `/api/companies/${company}`,
      body: { confirmName: "Hidden Traders" },
    },
    {
      route: "/api/companies/[id]/uploads",
      method: "POST",
      url: `/api/companies/${company}/uploads`,
      body: { fileName: "tb.csv", byteSize: 10 },
    },
    {
      route: "/api/companies/[id]/chat/names",
      method: "POST",
      url: `/api/companies/${company}/chat/names`,
      body: { tokens: ["PARTY_0123456789ab"] },
    },
    {
      route: "/api/uploads/[id]",
      method: "DELETE",
      url: `/api/uploads/${upload}`,
    },
    {
      route: "/api/uploads/[id]/complete",
      method: "POST",
      url: `/api/uploads/${upload}/complete`,
      body: {},
    },
    {
      route: "/api/uploads/[id]/chunks/[index]",
      method: "PUT",
      url: `/api/uploads/${upload}/chunks/0`,
      body: {},
    },
    {
      route: "/api/companies/[id]/dashboard",
      method: "GET",
      url: `/api/companies/${company}/dashboard`,
    },
    {
      route: "/api/companies/[id]/dashboard",
      method: "POST",
      url: `/api/companies/${company}/dashboard`,
      body: { action: "undo", baseVersion: 1 },
    },
    {
      route: "/api/companies/[id]/chat",
      method: "GET",
      url: `/api/companies/${company}/chat`,
    },
    {
      route: "/api/companies/[id]/template",
      method: "POST",
      url: `/api/companies/${company}/template`,
      body: { action: "undo", baseVersion: 1 },
    },
    {
      route: "/api/companies/[id]/restore",
      method: "POST",
      url: `/api/companies/${company}/restore`,
      body: {},
    },
    { route: "/api/jobs/[id]", method: "GET", url: `/api/jobs/${job}` },
    ...["confirm", "accept-quote", "deliver-dashboard", "heartbeat", "cancel"].map(
      (action) => ({
        route: "/api/jobs/[id]/[action]",
        method: "POST",
        url: `/api/jobs/${job}/${action}`,
        body: {},
      }),
    ),
    {
      route: "/api/jobs/[id]/run",
      method: "POST",
      url: `/api/jobs/${job}/run`,
      body: {},
    },
    {
      route: "/api/jobs/[id]/commentary",
      method: "GET",
      url: `/api/jobs/${job}/commentary`,
    },
    {
      route: "/api/jobs/[id]/commentary",
      method: "POST",
      url: `/api/jobs/${job}/commentary`,
      body: { period: "2027-01" },
    },
    { route: "/api/outputs/[id]", method: "GET", url: `/api/outputs/${output}` },
    {
      route: "/api/chat/threads/[id]",
      method: "GET",
      url: `/api/chat/threads/${thread}`,
    },
    {
      route: "/api/chat/messages/[id]/apply",
      method: "POST",
      url: `/api/chat/messages/${message}/apply`,
      body: { threadId: thread },
    },
    {
      route: "/api/account/export/[id]",
      method: "GET",
      url: `/api/account/export/${dataExport}`,
    },
    // Another tenant's ids in the body rather than the URL.
    {
      route: "/api/jobs",
      method: "POST",
      url: "/api/jobs",
      body: {
        companyId: company,
        type: "monthly_refresh",
        tier: "professional",
        delivery: "standard",
        size,
        fingerprints: {},
      },
    },
    {
      route: "/api/chat/messages",
      method: "POST",
      url: "/api/chat/messages",
      body: {
        companyId: company,
        threadId: thread,
        type: "quick",
        tier: "professional",
        text: "What was revenue?",
      },
    },
    ...(invoice === ""
      ? []
      : [
          {
            route: "/api/invoices/[id]/pdf",
            method: "GET",
            url: `/api/invoices/${invoice}/pdf`,
          },
        ]),
  ];

  // Coverage guard: every route with an id in its path (and the id-in-body routes above) is probed.
  const apiRoot = path.resolve(process.cwd(), "src", "app", "api");
  const idRoutes = readdirSync(apiRoot, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith("route.ts") && f.includes("["))
    .map((f) => `/api/${path.dirname(f).split(path.sep).join("/")}`)
    .filter((r) => r !== "/api/invoices/[id]/pdf" || invoice !== "");
  const probed = new Set(probes.map((p) => p.route));
  expect(
    idRoutes.filter((r) => !probed.has(r)),
    "id-scoped routes without a probe",
  ).toEqual([]);

  // The per-IP limit would refuse these before they ever reach the tenancy check, and a
  // 429 here would mean the probe proved nothing. Every request in this suite comes from
  // one IP; the limit itself has its own unit tests.
  await db.query(`delete from rate_limit_counters`);

  for (const probe of probes) {
    const response = await page.request.fetch(probe.url, {
      method: probe.method,
      headers: { "content-type": "application/json", "idempotency-key": randomUUID() },
      ...(probe.body === undefined ? {} : { data: probe.body }),
    });
    const text = await response.text();
    const label = `${probe.method} ${probe.url} → ${String(response.status())} ${text.slice(0, 120)}`;
    // Not found, or refused before looking (re-authentication, consent).
    expect([403, 404], label).toContain(response.status());
    expect(text, label).not.toContain("Hidden Traders");
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
  await reauthenticate();

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
