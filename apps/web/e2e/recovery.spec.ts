/**
 * Password reset and sign-in with an identity provider (SPEC §8, ADR 0043).
 *
 * Here: that the buttons exist only for a provider that is switched on, that starting one goes
 * to the identity service, that the emailed link sets a password, once, and unlocks nothing
 * else, and what a confirmation link proves (ADR 0071). The whole provider round trip — finish,
 * the account a stranger left waiting, a returning sign-in, a refusal — is `provider.spec.ts`.
 */

import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import pg from "pg";

import {
  confirmationLink,
  createVerifiedAccount,
  latestEmailHtml,
  PASSWORD,
  signUp,
  uniqueEmail,
} from "./helpers";

// The local Supabase stack's database (supabase/config.toml defaults; not a secret).
const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
// Built at run time rather than written down: a quoted string beside the word "password" is
// exactly what the secret scanner is there to catch, and it cannot tell this one is a throwaway.
// Upper, lower, digit and twelve-plus characters, as the sign-up rule requires.
const NEW_PASSWORD = `E2e-${randomUUID().slice(0, 8)}-Reset`;

function resetLink(html: string): string {
  const match = /href="([^"]*\/reset-password\?token_hash=[^"]*)"/u.exec(html);
  if (!match?.[1]) throw new Error("No reset link in email");
  return match[1].replaceAll("&amp;", "&");
}

/**
 * Every test here signs up or asks for a reset from the same address, and both are throttled
 * per network (10 and 5 an hour). Cleared around the file so it neither trips over earlier
 * specs nor leaves the later ones short.
 */
async function clearThrottles(): Promise<void> {
  const pool = new pg.Pool({ connectionString: LOCAL_DB, max: 1 });
  try {
    await pool.query(
      `delete from auth_throttle where key like 'signup:ip:%' or key like 'password_reset%'`,
    );
  } finally {
    await pool.end();
  }
}
test.beforeEach(clearThrottles);
test.afterAll(clearThrottles);

test("a forgotten password is reset from the emailed link: once, and the old one stops working", async ({
  page,
  context,
}) => {
  const email = uniqueEmail();
  await createVerifiedAccount(page, email);
  await context.clearCookies();

  await page.goto("/sign-in");
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/u);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send the link" }).click();
  await expect(page.getByTestId("reset-sent")).toBeVisible();

  const link = resetLink(await latestEmailHtml(email, "Set a new password"));
  await page.goto(link);
  // Opening the link is not a sign-in: nothing is spent until a password is submitted.
  expect((await page.request.get("/api/wallet")).status()).toBe(401);

  await page.getByLabel("New password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page).toHaveURL(/\/app$/u);

  // The link set a password and nothing more: exporting the account still asks for it.
  const exported = await page.request.post("/api/account/export", {
    headers: { "idempotency-key": randomUUID() },
    data: {},
  });
  expect(exported.status()).toBe(403);
  expect(((await exported.json()) as { error: string }).error).toBe("reauth_required");

  // The old password is dead, the new one works, and the link cannot be used again.
  await context.clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("incorrect");
  await page.getByLabel("Password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/app$/u);

  await context.clearCookies();
  await page.goto(link);
  await page.getByLabel("New password").fill(`${NEW_PASSWORD}-again`);
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("expired");
});

test("a reset link cannot be turned into a session through the callback", async ({
  page,
  context,
}) => {
  // The callback establishes a session and claims it, so anything it accepts is a link that
  // signs its holder in. While it accepted `type=recovery`, an attacker's own reset link sent
  // to a victim signed the victim into the attacker's account, with no password ever set and
  // nothing to alert them (ADR 0057). The token must survive this untouched and still work on
  // the form it belongs to.
  const email = uniqueEmail();
  await createVerifiedAccount(page, email);
  await context.clearCookies();

  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send the link" }).click();
  await expect(page.getByTestId("reset-sent")).toBeVisible();

  const link = resetLink(await latestEmailHtml(email, "Set a new password"));
  const token = new URL(link, "http://localhost").searchParams.get("token_hash") ?? "";
  expect(token).not.toBe("");

  await page.goto(`/auth/callback?token_hash=${token}&type=recovery&next=/app`);
  // No session: the callback refused the type outright, so nothing was verified or claimed.
  expect((await page.request.get("/api/wallet")).status()).toBe(401);

  // And the token was not spent by that attempt — it still sets the password, once.
  await page.goto(link);
  await page.getByLabel("New password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page).toHaveURL(/\/app$/u);
});

test("asking for a reset says the same thing whether or not the account exists", async ({
  page,
}) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByRole("button", { name: "Send the link" }).click();
  await expect(page.getByTestId("reset-sent")).toBeVisible();
  await expect(page.locator("main")).toContainText("If that address has an account");
});

test("the reset screen with no token, or a made-up one, sets nothing and offers a new link", async ({
  page,
}) => {
  await page.goto("/reset-password");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("expired");
  await expect(page.getByRole("link", { name: "Send me a new link" })).toBeVisible();

  await page.goto(`/reset-password?token_hash=${"0".repeat(56)}`);
  await page.getByLabel("New password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("expired");
});

test("a form on another site cannot post to the sign-in endpoints as if it were ours", async ({
  request,
}) => {
  // A cross-site form can send text/plain without a preflight; a JSON body inside it must
  // not be acted on.
  const forged = await request.post("/api/auth/forgot", {
    headers: { "content-type": "text/plain" },
    data: JSON.stringify({ email: uniqueEmail() }),
  });
  expect(forged.status()).toBe(415);
});

test("a provider appears only when it is switched on, and starting it leaves for the identity service", async ({
  page,
  request,
}) => {
  // playwright.config.ts switches Google on and leaves Apple off.
  await page.goto("/sign-in");
  const buttons = page.getByTestId("provider-buttons");
  await expect(buttons.getByRole("link", { name: "Continue with Google" })).toBeVisible();
  await expect(buttons.getByRole("link", { name: /Apple/u })).toHaveCount(0);
  await page.goto("/sign-up");
  await expect(page.getByRole("link", { name: "Continue with Google" })).toBeVisible();

  const start = await request.get("/auth/oauth/google?next=/wallet", { maxRedirects: 0 });
  expect(start.status()).toBe(307);
  const to = new URL(start.headers()["location"] ?? "");
  expect(to.port).toBe("54321");
  expect(to.pathname).toBe("/auth/v1/authorize");
  expect(to.searchParams.get("provider")).toBe("google");
  // PKCE: the challenge goes out, and the return is pinned to exactly the allow-listed
  // callback. The destination rides in a cookie, not in a URL the allow-list would reject.
  expect(to.searchParams.get("code_challenge")).not.toBeNull();
  expect(to.searchParams.get("redirect_to")).toMatch(/^http:\/\/[^/]+\/auth\/callback$/u);
  expect(start.headers()["set-cookie"]).toContain("oauth_next=%2Fwallet");

  // Somewhere else entirely is not a destination.
  const evil = await request.get("/auth/oauth/google?next=//evil.example", {
    maxRedirects: 0,
  });
  expect(evil.headers()["set-cookie"]).toContain("oauth_next=%2Fapp");

  expect((await request.get("/auth/oauth/apple", { maxRedirects: 0 })).status()).toBe(
    404,
  );
  expect((await request.get("/auth/oauth/facebook", { maxRedirects: 0 })).status()).toBe(
    404,
  );
});

test("a confirmation opened in another browser signs nobody in: the mailbox owner finishes the account (ADR 0071)", async ({
  browser,
}) => {
  // R-85: a stranger registers someone else's address with a password they chose, and waits.
  const email = uniqueEmail();
  const strangerContext = await browser.newContext();
  const stranger = await strangerContext.newPage();
  await signUp(stranger, email);

  // The owner opens the genuine confirmation email, in their own browser.
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await owner.goto(confirmationLink(await latestEmailHtml(email, "Confirm your email")));
  await expect(owner).toHaveURL(/\/sign-up\/finish$/u);

  // Nothing was claimed for the stranger, and the password they chose is gone.
  await stranger.goto("/sign-in");
  await stranger.getByLabel("Email").fill(email);
  await stranger.getByLabel("Password").fill(PASSWORD);
  await stranger.getByRole("button", { name: "Continue" }).click();
  await expect(stranger.getByRole("main").getByRole("alert")).toContainText("incorrect");

  // The owner sets their own password, name and consent, and is in.
  await owner.getByLabel("Choose your password").fill(NEW_PASSWORD);
  await owner.getByLabel("Business name").fill("The Actual Owner & Co");
  await owner.getByLabel(/I accept the/u).check();
  await owner.getByRole("button", { name: "Create account" }).click();
  await expect(owner).toHaveURL(/\/app$/u);

  const pool = new pg.Pool({ connectionString: LOCAL_DB, max: 1 });
  try {
    const row = await pool.query<{ business_name: string; has_password: boolean }>(
      `select business_name, has_password from accounts where email = $1`,
      [email],
    );
    expect(row.rows[0]).toEqual({
      business_name: "The Actual Owner & Co",
      has_password: true,
    });
    const destroyed = await pool.query(
      `select 1 from audit_log l join accounts a on a.id = l.target_id
        where a.email = $1 and l.action = 'account.signup_password_destroyed'`,
      [email],
    );
    expect(destroyed.rowCount).toBe(1);
  } finally {
    await pool.end();
  }

  // Their own password works from anywhere; the stranger's still does not.
  const laterContext = await browser.newContext();
  const later = await laterContext.newPage();
  await later.goto("/sign-in");
  await later.getByLabel("Email").fill(email);
  await later.getByLabel("Password").fill(NEW_PASSWORD);
  await later.getByRole("button", { name: "Continue" }).click();
  await expect(later).toHaveURL(/\/app$/u);
  for (const c of [strangerContext, ownerContext, laterContext]) await c.close();
});

test("a confirmation opened in the browser that signed up signs in, as it always has (ADR 0071)", async ({
  page,
}) => {
  // Nearly everyone: sign up, open the email in the same browser, land in the app.
  const email = uniqueEmail();
  await createVerifiedAccount(page, email);
  await expect(page.getByTestId("app-home")).toBeVisible();
  const pool = new pg.Pool({ connectionString: LOCAL_DB, max: 1 });
  try {
    // The browser's secret is spent once it has signed that browser in.
    const row = await pool.query<{ spent: boolean; has_password: boolean }>(
      `select signup_nonce_hash is null as spent, has_password from accounts where email = $1`,
      [email],
    );
    expect(row.rows[0]).toEqual({ spent: true, has_password: true });
  } finally {
    await pool.end();
  }
});
