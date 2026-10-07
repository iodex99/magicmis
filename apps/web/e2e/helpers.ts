import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";

import {
  IDENTITY_HOST,
  identityCode,
  type ProviderIdentity,
} from "./support/identity-provider";

export const MAILPIT = "http://127.0.0.1:54324";
export const PASSWORD = "E2e-Correct-Horse-42";

/** A real, decodable one-pixel PNG: the smallest logo a browser will actually draw. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

export function uniqueEmail(): string {
  return `e2e-${randomUUID().slice(0, 8)}@example.test`;
}

interface MailpitSummary {
  ID: string;
  Subject: string;
}

/** Poll Mailpit for the newest message to `email` and return its HTML body. */
export async function latestEmailHtml(
  email: string,
  subjectIncludes: string,
): Promise<string> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const search = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
    );
    const body = (await search.json()) as { messages?: MailpitSummary[] };
    const match = body.messages?.find((m) => m.Subject.includes(subjectIncludes));
    if (match) {
      const message = await fetch(`${MAILPIT}/api/v1/message/${match.ID}`);
      const detail = (await message.json()) as { HTML?: string };
      if (detail.HTML) return detail.HTML;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`No "${subjectIncludes}" email reached ${email} within 30s`);
}

export function confirmationLink(html: string): string {
  const match = /href="([^"]*\/auth\/callback[^"]*)"/u.exec(html);
  if (!match?.[1]) throw new Error("No confirmation link in email");
  return match[1].replaceAll("&amp;", "&");
}

export async function signUp(page: Page, email: string): Promise<void> {
  await page.goto("/sign-up");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Business name").fill("E2E Test Associates");
  await page.getByLabel(/I accept the/u).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/sign-up\/check-email/u);
}

/** The confirmation link establishes the session, so it lands straight in the app. */
export async function verifyEmail(page: Page, email: string): Promise<void> {
  const html = await latestEmailHtml(email, "Confirm your email");
  await page.goto(confirmationLink(html));
  await expect(page).toHaveURL(/\/app$/u);
}

/** Full new-account journey: sign up, confirm the email, land in the app. */
export async function createVerifiedAccount(page: Page, email: string): Promise<void> {
  await signUp(page, email);
  await verifyEmail(page, email);
}

/** The whole of signing in: the password is the only factor (ADR 0028). */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/app$/u);
}

/**
 * Press "Continue with Google" on `start` and come back as `who` (ADR 0082) — or, given
 * `"decline"`, as someone who turned the provider down.
 *
 * Everything on our side runs for real: the button, the start route writing the PKCE verifier and
 * the destination into this browser, the identity service exchanging the code with a provider
 * and linking or creating the user, and the callback exchanging and claiming the session. Two
 * steps are stood in for. At the identity service's front door the provider is swapped for the
 * Keycloak stand-in (`support/identity-provider.ts`), because Google's endpoints cannot be
 * pointed anywhere else; the start route's answer is still checked to be Google's. And the page
 * where a person signs in at the provider is played here: it hands the identity service a code
 * that says who this is, which the stand-in then vouches for on the server side.
 *
 * A browser follows redirects without showing them to a route handler, so the chain is walked
 * here, one hop at a time, from the click on the button: the start route's real response (and
 * the cookies it writes into this browser), then the identity service's real authorize, then the
 * provider's answer — and the browser is sent on from there to the identity service's callback,
 * which redirects to ours.
 *
 * Resolves once the browser is back on the app with the round trip finished.
 */
export async function signInThroughProvider(
  page: Page,
  who: ProviderIdentity | "decline",
  start = "/sign-in",
): Promise<void> {
  const isStart = (url: URL) => url.pathname === "/auth/oauth/google";
  await page.route(isStart, async (route) => {
    // Our start route, unchanged: a redirect to the identity service, and its cookies.
    const started = await route.fetch({ maxRedirects: 0 });
    expect(started.status()).toBe(307);
    const cookies = started
      .headersArray()
      .filter((h) => h.name.toLowerCase() === "set-cookie")
      .map((h) => parseSetCookie(h.value, route.request().url()));
    await page.context().addCookies(cookies);
    expect(cookies.map((c) => c.name)).toContain("oauth_next");
    expect(cookies.some((c) => c.name.endsWith("-code-verifier"))).toBe(true);

    const authorize = new URL(started.headers()["location"] ?? "");
    expect(authorize.pathname).toBe("/auth/v1/authorize");
    expect(authorize.searchParams.get("provider")).toBe("google");
    authorize.searchParams.set("provider", "keycloak");

    // The identity service's own authorize, which sends the person to the provider.
    const toProvider = await page.request.get(authorize.toString(), { maxRedirects: 0 });
    expect(toProvider.status()).toBe(302);
    const asked = new URL(toProvider.headers()["location"] ?? "");
    expect(asked.hostname).toBe(IDENTITY_HOST);
    expect(asked.pathname).toBe("/protocol/openid-connect/auth");

    // The person at the provider: who they are, or no.
    const back = new URL(asked.searchParams.get("redirect_uri") ?? "");
    back.searchParams.set("state", asked.searchParams.get("state") ?? "");
    if (who === "decline") {
      back.searchParams.set("error", "access_denied");
      back.searchParams.set("error_description", "The person declined");
    } else {
      back.searchParams.set("code", identityCode(who));
    }
    await route.fulfill({ status: 302, headers: { location: back.toString() } });
  });
  try {
    await page.goto(start);
    await page.getByRole("link", { name: "Continue with Google" }).click();
    // Back on the app, past the callback.
    await page.waitForURL(
      (url) =>
        url.port === "3000" &&
        !url.pathname.startsWith("/auth/") &&
        url.href !== new URL(start, url).href,
    );
  } finally {
    await page.unroute(isStart);
  }
}

/** One `Set-Cookie` header as Playwright's `addCookies` takes it. */
function parseSetCookie(header: string, requestUrl: string) {
  const [pair = "", ...attributes] = header.split(";").map((part) => part.trim());
  const at = pair.indexOf("=");
  const attribute = (key: string) =>
    attributes.find((a) => a.toLowerCase().startsWith(`${key}=`))?.slice(key.length + 1);
  const flags = attributes.map((a) => a.toLowerCase());
  const sameSite = attribute("samesite")?.toLowerCase();
  return {
    name: pair.slice(0, at),
    value: pair.slice(at + 1),
    domain: new URL(requestUrl).hostname,
    path: attribute("path") ?? "/",
    httpOnly: flags.includes("httponly"),
    secure: flags.includes("secure"),
    sameSite:
      sameSite === "strict"
        ? ("Strict" as const)
        : sameSite === "none"
          ? ("None" as const)
          : ("Lax" as const),
  };
}

/**
 * SPEC §30: collects Content Security Policy violations reported to the console, so a flow that
 * works only because the policy was bypassed still fails. Assert the array is empty at the end.
 */
export function watchCspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/Content Security Policy/iu.test(text)) violations.push(text);
  });
  return violations;
}

export const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/**
 * The welcome credits an account was granted at its first sign-in, or 0 when they were withheld
 * (ADR 0068). Every request in the suite comes from one address, so which accounts get them
 * depends on the network limit and on test order: a test that counts credits reads this rather
 * than assuming either way.
 */
export async function welcomeGranted(email: string): Promise<bigint> {
  const { default: pg } = await import("pg");
  const db = new pg.Pool({ connectionString: LOCAL_DB, max: 1 });
  try {
    const r = await db.query<{ credits: string }>(
      `select w.credits::text from welcome_credits w join accounts a on a.id = w.account_id
        where a.email = $1`,
      [email],
    );
    return BigInt(r.rows[0]?.credits ?? "0");
  } finally {
    await db.end();
  }
}

/**
 * Take an account's credits away, as support would with an adjustment, for a test of what an
 * account with nothing in its wallet sees. Since ADR 0068 a new account may start with welcome
 * credits, so "never bought anything" no longer means "has nothing".
 */
export async function emptyTheWallet(email: string): Promise<void> {
  const { default: pg } = await import("pg");
  const { adminAdjust } = await import("@magicmis/wallet");
  const db = new pg.Pool({ connectionString: LOCAL_DB, max: 1 });
  try {
    const r = await db.query<{ id: string; available: string }>(
      `select a.id, (w.balance_credits - w.held_credits)::text as available
         from accounts a join wallets w on w.account_id = a.id where a.email = $1`,
      [email],
    );
    const row = r.rows[0];
    if (row === undefined) throw new Error(`no wallet for ${email}`);
    const available = BigInt(row.available);
    if (available > 0n)
      await adminAdjust(db, {
        accountId: row.id,
        delta: -available,
        reason: "E2E: start from an empty wallet",
        adminId: randomUUID(),
        idempotencyKey: randomUUID(),
      });
  } finally {
    await db.end();
  }
}
