import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";
import { TOTP } from "otpauth";

export const MAILPIT = "http://127.0.0.1:54324";
export const PASSWORD = "E2e-Correct-Horse-42";

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

/** A TOTP code for the given base32 secret, as an authenticator app would show it. */
export function totpCode(secret: string, offsetSeconds = 0): string {
  return new TOTP({ secret, digits: 6, period: 30, algorithm: "SHA1" }).generate({
    timestamp: Date.now() + offsetSeconds * 1000,
  });
}

/**
 * Wait until the next 30-second TOTP window, so a code is never reused within a window.
 * Auth servers may reject a code already used for another verification.
 */
export async function nextTotpWindow(): Promise<void> {
  const msIntoWindow = Date.now() % 30_000;
  await new Promise((resolve) => setTimeout(resolve, 30_000 - msIntoWindow + 500));
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

/**
 * The confirmation link establishes the session, so it lands on authenticator setup
 * rather than sending the user back to sign in with the password they just chose.
 */
export async function verifyEmail(page: Page, email: string): Promise<void> {
  const html = await latestEmailHtml(email, "Confirm your email");
  await page.goto(confirmationLink(html));
  await expect(page).toHaveURL(/\/sign-in\/enrol/u);
}

export async function passwordStep(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
}

/** Full new-account journey. Returns the TOTP secret for later sign-ins. */
export async function createVerifiedAccountWithTotp(
  page: Page,
  email: string,
): Promise<string> {
  await signUp(page, email);
  await verifyEmail(page, email);

  const secret = (await page.getByTestId("totp-secret").textContent())?.trim() ?? "";
  expect(secret).toMatch(/^[A-Z2-7]+=*$/u);
  await page.getByLabel("6-digit code").fill(totpCode(secret));
  await page.getByRole("button", { name: "Verify and continue" }).click();

  await expect(page.getByTestId("backup-codes")).toBeVisible();
  await expect(page.getByTestId("backup-codes").locator("li")).toHaveCount(10);
  await page.getByLabel(/I have saved my backup codes/u).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/app$/u);
  return secret;
}

export async function signInWithTotp(
  page: Page,
  email: string,
  secret: string,
): Promise<void> {
  await passwordStep(page, email);
  await expect(page).toHaveURL(/\/sign-in\/mfa/u);
  await page.getByLabel("6-digit code").fill(totpCode(secret));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/app$/u);
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
