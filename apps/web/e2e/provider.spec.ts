/**
 * Signing up and signing in with Google, the whole round trip (ADR 0043, ADR 0082).
 *
 * The button, the start route, the identity service's code exchange and account linking, our
 * callback, the finish step, welcome credits, the single session and the re-check all run for
 * real. Only the provider itself is stood in for — see `signInThroughProvider` in `helpers.ts`
 * and `support/identity-provider.ts` for exactly which two steps, and why.
 */

import { randomUUID } from "node:crypto";

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import pg from "pg";

import {
  createVerifiedAccount,
  latestEmailHtml,
  PASSWORD,
  signInThroughProvider,
  signUp,
  uniqueEmail,
} from "./helpers";

// The local Supabase stack's database (supabase/config.toml defaults; not a secret).
const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
// Built at run time, as in recovery.spec.ts: the secret scanner cannot tell a throwaway.
const NEW_PASSWORD = `E2e-${randomUUID().slice(0, 8)}-Owner`;

async function query<T extends pg.QueryResultRow>(
  sql: string,
  params: unknown[],
): Promise<T[]> {
  const pool = new pg.Pool({ connectionString: LOCAL_DB, max: 1 });
  try {
    return (await pool.query<T>(sql, params)).rows;
  } finally {
    await pool.end();
  }
}

/** Sign-ups and resets in this file come from one address; the product throttles both. */
async function clearThrottles(): Promise<void> {
  await query(
    `delete from auth_throttle where key like 'signup:ip:%' or key like 'password_reset%'`,
    [],
  );
}
test.beforeEach(clearThrottles);
test.afterAll(clearThrottles);

interface AccountRow {
  business_name: string;
  has_password: boolean;
  providers: string[];
  welcome_decisions: number;
}

async function account(email: string): Promise<AccountRow | undefined> {
  const rows = await query<AccountRow>(
    `select a.business_name, a.has_password,
            array(select i.provider from auth.identities i
                   where i.user_id = a.auth_user_id order by i.provider) as providers,
            (select count(*)::int from welcome_credits w where w.account_id = a.id)
              as welcome_decisions
       from accounts a where a.email = $1 and a.deleted_at is null`,
    [email],
  );
  return rows[0];
}

/**
 * A browser whose every request comes from an address of its own, as the platform edge would
 * say. Welcome credits are granted three times per network (ADR 0068), and by the time this
 * file runs the suite's one address has used them, so a deferral would read as never decided.
 */
async function freshBrowser(browser: Browser): Promise<BrowserContext> {
  const octet = () => String(Math.floor(Math.random() * 250) + 1);
  return browser.newContext({
    extraHTTPHeaders: { "x-vercel-forwarded-for": `198.51.${octet()}.${octet()}` },
  });
}

async function passwordSignIn(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
}

async function finish(page: Page, businessName: string): Promise<void> {
  await expect(page).toHaveURL(/\/sign-up\/finish$/u);
  // The provider proved the address; nobody here is asked to choose a password.
  await expect(page.getByLabel("Choose your password")).toHaveCount(0);
  await page.getByLabel("Business name").fill(businessName);
  await page.getByLabel(/I accept the/u).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/app$/u);
  await expect(page.getByTestId("app-home")).toBeVisible();
}

test("someone new through Google finishes with a name and consent, and the emailed link gives them a password", async ({
  browser,
}) => {
  const context = await freshBrowser(browser);
  const page = await context.newPage();
  const email = uniqueEmail();
  await signInThroughProvider(page, { email }, "/sign-up");

  // A verified identity and no account: nothing is created until they say what to call the
  // business and accept the terms, and consent is not optional here either.
  expect(await account(email)).toBeUndefined();
  await expect(page).toHaveURL(/\/sign-up\/finish$/u);
  await page.getByLabel("Business name").fill("Provider Path Associates");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Accept the Terms",
  );
  await finish(page, "Provider Path Associates");

  // Created with no password, through the provider, and the welcome offer decided once, at
  // this first sign-in, like every other path that claims a session (ADR 0068).
  expect(await account(email)).toEqual({
    business_name: "Provider Path Associates",
    has_password: false,
    providers: ["keycloak"],
    welcome_decisions: 1,
  });
  const consents = await query<{ document: string }>(
    `select c.document from consents c join accounts a on a.id = c.account_id
      where a.email = $1 order by c.document`,
    [email],
  );
  expect(consents.map((c) => c.document)).toEqual(["privacy", "terms"]);

  // The re-check for a sensitive action has no password to ask for, and says how to get one.
  await page.goto("/settings/privacy");
  await page.getByRole("button", { name: "Request export" }).click();
  await page.getByLabel("Current password").fill(PASSWORD);
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByTestId("no-password")).toContainText("has no password yet");
  await page.getByRole("link", { name: "Email me the link" }).click();

  // The reset link sets one, and the account then has it.
  await expect(page).toHaveURL(/\/forgot-password$/u);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send the link" }).click();
  await expect(page.getByTestId("reset-sent")).toBeVisible();
  const html = await latestEmailHtml(email, "Set a new password");
  const link = /href="([^"]*\/reset-password\?token_hash=[^"]*)"/u.exec(html)?.[1];
  expect(link).toBeDefined();
  await page.goto((link ?? "").replaceAll("&amp;", "&"));
  await page.getByLabel("New password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page).toHaveURL(/\/app$/u);
  expect((await account(email))?.has_password).toBe(true);

  // Now the re-check takes it, and the password signs in from anywhere.
  await page.goto("/settings/privacy");
  await page.getByRole("button", { name: "Request export" }).click();
  await page.getByLabel("Current password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByTestId("no-password")).toHaveCount(0);
  await context.clearCookies();
  await passwordSignIn(page, email, NEW_PASSWORD);
  await expect(page).toHaveURL(/\/app$/u);
  await context.close();
});

test("a returning Google sign-in goes straight to where it was going, and ends the session before it", async ({
  browser,
}) => {
  const email = uniqueEmail();
  const firstContext = await browser.newContext();
  const first = await firstContext.newPage();
  await signInThroughProvider(first, { email }, "/sign-up");
  await finish(first, "Returning Visitor Ltd");

  // Somewhere else, later, from a link into the Wallet: no finish step, and the destination
  // survives the round trip in its cookie rather than in a URL the allow-list would refuse.
  const laterContext = await browser.newContext();
  const later = await laterContext.newPage();
  await signInThroughProvider(later, { email }, "/sign-in?next=/wallet");
  await expect(later).toHaveURL(/\/wallet$/u);
  // Spent at the callback, so it cannot steer the next link opened in this browser.
  const carried = (await laterContext.cookies()).find((c) => c.name === "oauth_next");
  expect(carried?.value ?? "").toBe("");

  // One login per account (SPEC §2.2): the first browser's session is over.
  await first.goto("/app");
  await expect(first).toHaveURL(/\/signed-out\?reason=elsewhere$/u);

  // Still one account, not a second one beside it.
  const rows = await query(`select 1 from accounts where email = $1`, [email]);
  expect(rows.length).toBe(1);
  for (const c of [firstContext, laterContext]) await c.close();
});

test("a password sign-up nobody has signed in to is not handed over through Google: its password is destroyed and the owner finishes it", async ({
  browser,
}) => {
  // A stranger registers someone else's address with a password they chose, and waits for the
  // owner to walk in through Google (ADR 0043).
  const email = uniqueEmail();
  const strangerContext = await browser.newContext();
  const stranger = await strangerContext.newPage();
  await signUp(stranger, email);

  const ownerContext = await freshBrowser(browser);
  const owner = await ownerContext.newPage();
  await signInThroughProvider(owner, { email });
  // The identity service linked Google to the stranger's user, and we did not claim it.
  await finish(owner, "The Actual Owner & Co");

  // The owner's name and consent, not the stranger's; no password, since the one on the row
  // was the stranger's and is gone. The identity service drops the unconfirmed email identity
  // when it links a verified provider to it, so Google is the only way in left.
  expect(await account(email)).toEqual({
    business_name: "The Actual Owner & Co",
    has_password: false,
    providers: ["keycloak"],
    welcome_decisions: 1,
  });
  const claimed = await query(
    `select 1 from audit_log l join accounts a on a.id = l.target_id
      where a.email = $1 and l.action = 'account.claimed_by_verified_identity'`,
    [email],
  );
  expect(claimed.length).toBe(1);

  // The stranger's password opens nothing.
  await passwordSignIn(stranger, email, PASSWORD);
  await expect(stranger.getByRole("main").getByRole("alert")).toContainText("incorrect");
  for (const c of [strangerContext, ownerContext]) await c.close();
});

test("an account in use keeps its password when its owner later continues with Google", async ({
  browser,
}) => {
  const email = uniqueEmail();
  const ownContext = await browser.newContext();
  await createVerifiedAccount(await ownContext.newPage(), email);
  await ownContext.close();

  const context = await browser.newContext();
  const page = await context.newPage();
  await signInThroughProvider(page, { email });
  // Someone has signed in to this account, so it is theirs: Google is linked and signs in.
  await expect(page).toHaveURL(/\/app$/u);
  const row = await account(email);
  expect(row?.has_password).toBe(true);
  expect(row?.business_name).toBe("E2E Test Associates");
  expect(row?.providers).toEqual(["email", "keycloak"]);

  await context.clearCookies();
  await passwordSignIn(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/app$/u);
  await context.close();
});

test("a sign-in turned down at the provider comes back to say so, and signs nobody in", async ({
  page,
}) => {
  await signInThroughProvider(page, "decline");
  // The identity service repeats the error in a fragment; the query is ours.
  await expect(page).toHaveURL(/\/sign-in\?provider=failed(#.*)?$/u);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("did not finish");
  expect((await page.request.get("/api/wallet")).status()).toBe(401);

  // The destination is expired on the path it was written to: deleting it on `/` left it in
  // place for its whole ten minutes.
  const back = await page.request.get("/auth/callback?error=access_denied", {
    headers: { cookie: "oauth_next=%2Fwallet" },
    maxRedirects: 0,
  });
  expect(back.headers()["set-cookie"]).toMatch(
    /oauth_next=; Path=\/auth\/callback; Max-Age=0/u,
  );
});
