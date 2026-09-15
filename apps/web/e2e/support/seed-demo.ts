/**
 * Creates one signed-up, email-verified, TOTP-enrolled account on the local stack and funds
 * its wallet with an admin grant, so the app can be looked at without hand-walking sign-up.
 *
 * Local development only: it talks to the local Supabase Postgres and Mailpit by their
 * `supabase/config.toml` defaults, and prints the TOTP secret. Never point it at a real stack.
 *
 *   pnpm --filter @magicmis/web exec tsx e2e/support/seed-demo.ts [credits]
 */

import { chromium } from "@playwright/test";
import { grantCredits } from "@magicmis/wallet";
import pg from "pg";

import { createVerifiedAccountWithTotp, PASSWORD, uniqueEmail } from "../helpers";

// The local Supabase stack's database (supabase/config.toml defaults; not a secret).
const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const APP_URL = "http://127.0.0.1:3000";

const credits = BigInt(process.argv[2] ?? "20000");
const email = uniqueEmail();

const pool = new pg.Pool({ connectionString: LOCAL_DB, max: 2 });
const browser = await chromium.launch();
try {
  // The product's own per-IP sign-up throttle refuses repeated local runs.
  await pool.query(`delete from auth_throttle where key like 'signup:ip:%'`);

  const context = await browser.newContext({ baseURL: APP_URL });
  const page = await context.newPage();
  let secret: string;
  try {
    secret = await createVerifiedAccountWithTotp(page, email);
  } catch (cause) {
    const alerts = await page.getByRole("alert").allTextContents();
    throw new Error(`sign-up failed at ${page.url()}: ${alerts.join(" | ")}`, { cause });
  }

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

  const issuer = encodeURIComponent("MIS Studio");
  process.stdout.write(
    [
      `email:    ${email}`,
      `password: ${PASSWORD}`,
      `totp:     ${secret}`,
      `otpauth:  otpauth://totp/${issuer}:${email}?secret=${secret}&issuer=${issuer}`,
      `credits:  ${credits.toString()}`,
      "",
    ].join("\n"),
  );
} finally {
  await browser.close();
  await pool.end();
}
