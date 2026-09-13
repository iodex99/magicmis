/**
 * Phase 1 acceptance (SPEC §34):
 *   - E2E auth flows pass
 *   - second login terminates the first session
 *   - app unusable without 2FA
 */

import { expect, test } from "@playwright/test";

import {
  createVerifiedAccountWithTotp,
  nextTotpWindow,
  passwordStep,
  signInWithTotp,
  signUp,
  uniqueEmail,
  verifyEmail,
} from "./helpers";

test("sign up, verify email, enrol TOTP, receive backup codes, reach the app", async ({
  page,
}) => {
  const email = uniqueEmail();
  await createVerifiedAccountWithTotp(page, email);
  await expect(page.getByTestId("app-home")).toBeVisible();
  await expect(page.getByText("E2E Test Associates")).toBeVisible();
});

test("app is unusable without 2FA: a password alone reaches nothing", async ({
  page,
}) => {
  const email = uniqueEmail();
  await signUp(page, email);
  await verifyEmail(page, email);
  await passwordStep(page, email);
  await expect(page).toHaveURL(/\/sign-in\/enrol/u);

  // Navigating straight to the app is refused and sent back to the second factor.
  await page.goto("/app");
  await expect(page).toHaveURL(/\/sign-in\/mfa/u);

  // Every data API refuses the aal1 session.
  for (const path of [
    "/api/account/profile",
    "/api/account/login-history",
    "/api/account/backup-codes",
  ]) {
    const response = await page.request.get(path);
    expect(response.status(), path).toBe(401);
    expect(((await response.json()) as { error: string }).error, path).toBe(
      "mfa_required",
    );
  }
});

test("second login terminates the first session", async ({ browser }) => {
  const email = uniqueEmail();

  const first = await browser.newContext();
  const firstPage = await first.newPage();
  const secret = await createVerifiedAccountWithTotp(firstPage, email);
  expect((await firstPage.request.get("/api/account/profile")).status()).toBe(200);

  // A fresh TOTP window, so the second sign-in never reuses the enrolment code.
  await nextTotpWindow();

  const second = await browser.newContext();
  const secondPage = await second.newPage();
  await signInWithTotp(secondPage, email, secret);
  expect((await secondPage.request.get("/api/account/profile")).status()).toBe(200);

  // The first tab is now refused, and says why.
  const stale = await firstPage.request.get("/api/account/profile");
  expect(stale.status()).toBe(401);
  expect(((await stale.json()) as { error: string }).error).toBe("session_superseded");

  await firstPage.goto("/app");
  await expect(firstPage).toHaveURL(/\/signed-out\?reason=elsewhere/u);
  await expect(firstPage.getByTestId("signed-out-reason")).toHaveText(
    "You were signed out because this account signed in elsewhere.",
  );

  // The login history on the surviving session records both sign-ins.
  const history = (await (
    await secondPage.request.get("/api/account/login-history")
  ).json()) as {
    events: { type: string }[];
  };
  expect(history.events.filter((e) => e.type === "login")).toHaveLength(2);
  expect(history.events.some((e) => e.type === "session_revoked")).toBe(true);

  await first.close();
  await second.close();
});

test("desktop-only gate shows a clear page to a phone", async ({ browser }) => {
  const phone = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    viewport: { width: 390, height: 844 },
  });
  const page = await phone.newPage();
  await page.goto("/sign-in");
  await expect(
    page.getByRole("heading", { name: "Please use a desktop computer" }),
  ).toBeVisible();

  // The public home stays reachable on a phone (SPEC §32).
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Create an account" })).toBeVisible();
  await phone.close();
});

test("mutating APIs require an Idempotency-Key", async ({ page }) => {
  const email = uniqueEmail();
  await createVerifiedAccountWithTotp(page, email);
  const response = await page.request.patch("/api/account/profile", {
    data: {
      businessName: "Changed",
      billingAddress: { line1: "x", city: "y", pincode: "411001", stateCode: "27" },
    },
  });
  expect(response.status()).toBe(400);
  expect(((await response.json()) as { error: string }).error).toBe(
    "idempotency_key_required",
  );
});
