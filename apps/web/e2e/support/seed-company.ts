/**
 * Creates a funded account and takes it all the way to a working board: one company set up
 * from thirteen months of synthetic trial balances, through the UI, the way a customer would.
 * For looking at the app — the dashboard, the chat, Where to act — without hand-walking sign-up
 * and a thirteen-file run every time.
 *
 * Local development only: it talks to the local Supabase Postgres and Mailpit by their
 * `supabase/config.toml` defaults, funds the wallet with an admin grant, and prints a working
 * password. Never point it at a real stack.
 *
 *   pnpm --filter @magicmis/web exec tsx e2e/support/seed-company.ts [name] [credits]
 *
 * Needs the app running on 127.0.0.1:3000 and the fixtures generated
 * (`pnpm --filter @magicmis/fixtures generate`).
 */

import path from "node:path";

import { chromium } from "@playwright/test";
import { grantCredits } from "@magicmis/wallet";
import pg from "pg";

import { FIXTURES_OUT } from "../fixtures-setup";
import { createVerifiedAccount, PASSWORD, uniqueEmail } from "../helpers";

// The local Supabase stack's database (supabase/config.toml defaults; not a secret).
const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const APP_URL = "http://127.0.0.1:3000";

const name = process.argv[2] ?? "Northwind Hardware Traders";
const credits = BigInt(process.argv[3] ?? "20000");

// A full financial year and the month that opens the next one: enough for every box on the
// board to have a trend and for a year-on-year question to have an answer.
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
const trialBalance = (month: string) =>
  path.join(FIXTURES_OUT, "trading", "clean", `trial_balance_${month}.xlsx`);

const email = uniqueEmail();
const pool = new pg.Pool({ connectionString: LOCAL_DB, max: 2 });
const browser = await chromium.launch();
const say = (line: string) => process.stdout.write(`${line}\n`);

try {
  // The product's own per-IP sign-up throttle refuses repeated local runs.
  await pool.query(`delete from auth_throttle where key like 'signup:ip:%'`);

  const context = await browser.newContext({ baseURL: APP_URL });
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);

  say("signing up…");
  await createVerifiedAccount(page, email);
  const consent = await page.request.post("/api/account/consents", {
    data: { document: "processing" },
    headers: { "idempotency-key": crypto.randomUUID() },
  });
  if (!consent.ok()) throw new Error(`consent failed: HTTP ${String(consent.status())}`);

  // Razorpay needs live test keys locally (ADR 0012), so fund the way an admin grant would.
  const account = await pool.query<{ id: string }>(
    `select id from accounts where email = $1`,
    [email],
  );
  const accountId = account.rows[0]?.id;
  if (accountId === undefined) throw new Error("account row not found");
  await grantCredits(pool, {
    accountId,
    credits,
    source: "admin_grant",
    idempotencyKey: crypto.randomUUID(),
  });

  say(`adding ${name}…`);
  await page.goto("/app");
  await page.getByLabel("Company name").fill(name);
  await page.getByRole("button", { name: "Add company" }).click();
  await page.waitForURL(/\/app\/companies\/[0-9a-f-]+$/u);
  const companyId = page.url().split("/").pop() ?? "";

  say(
    `running ${MONTHS.length.toString()} months — this is a real run, give it a minute…`,
  );
  await page.getByLabel("Choose files").setInputFiles(MONTHS.map(trialBalance));
  await page.getByTestId("job-run").click({ timeout: 180_000 });
  await page.getByTestId("job-done").waitFor({ timeout: 300_000 });
  const charged = (await page.getByTestId("job-done").textContent()) ?? "";

  say("");
  say("=== seeded ===");
  say(`email:     ${email}`);
  say(`password:  ${PASSWORD}`);
  say(`workspace: ${APP_URL}/app/companies/${companyId}`);
  say(`run:       ${charged.replace(/\s+/gu, " ").trim()}`);
} finally {
  await browser.close();
  await pool.end();
}
