/**
 * Phase 2 customer surfaces (SPEC §12, §13): public pricing, wallet with GST shown before
 * payment, bank-transfer proforma with PDF download, price preview, webhook refusal.
 * The Razorpay card flow itself needs live test credentials and is covered by the
 * packages/billing integration tests with a fake gateway.
 */

import { expect, test } from "@playwright/test";

import { createVerifiedAccount, uniqueEmail } from "./helpers";

test("pricing is public and shows credits per tier, never AI cost", async ({ page }) => {
  await page.goto("/pricing");
  const table = page.getByTestId("price-list");
  await expect(table).toBeVisible();
  await expect(table.getByRole("row", { name: /Company setup/u })).toContainText("999");
  await expect(page.locator("body")).not.toContainText(/ratio|token|model/iu);
});

test("wallet shows GST before payment, issues a proforma and serves its PDF", async ({
  page,
}) => {
  await createVerifiedAccount(page, uniqueEmail());
  await page.getByRole("link", { name: "Wallet" }).click();
  await expect(page).toHaveURL(/\/wallet$/u);
  await expect(page.getByTestId("wallet-balance")).toContainText("0");

  // Billing details are asked for here, at the first purchase, rather than at sign-up:
  // GST place of supply is needed to quote a pack and at no earlier moment.
  await expect(
    page.getByRole("heading", { name: "Where should we invoice this?" }),
  ).toBeVisible();
  await page.getByLabel("Address line 1").fill("1 Test Road");
  await page.getByLabel("City").fill("Pune");
  await page.getByLabel("PIN code").fill("411001");
  await page.getByLabel("State").selectOption("27");
  await page.getByRole("button", { name: "Save and show prices" }).click();

  // Maharashtra buyer, Maharashtra seller → CGST + SGST shown before paying.
  const row = page.getByRole("row", { name: /25,000/u }).first();
  await expect(row).toContainText("₹25,000.00");
  await expect(row).toContainText("CGST ₹2,250.00 + SGST ₹2,250.00");
  await expect(row).toContainText("₹29,500.00");

  // SPEC §2.3: previewing a price is free and says whether the balance covers it.
  const preview = await page.request.post("/api/pricing/preview", {
    data: { actionKey: "company_setup", tier: "professional", delivery: "standard" },
  });
  expect(preview.status()).toBe(200);
  const body = (await preview.json()) as Record<string, unknown>;
  expect(body).toMatchObject({ credits: "999", available: "0", sufficient: false });
  expect(JSON.stringify(body)).not.toMatch(/cap|ratio|paise/iu);

  await row.getByRole("button", { name: "Bank transfer" }).click();
  await expect(page.getByRole("status")).toContainText(
    /Proforma PRO\/\d\d-\d\d\/\d{6} issued/u,
  );
  const invoices = page.getByTestId("invoices");
  await expect(invoices).toContainText("Proforma");

  const href = await invoices
    .getByRole("link", { name: "Download PDF" })
    .first()
    .getAttribute("href");
  expect(href).toMatch(/^\/api\/invoices\/[0-9a-f-]{36}\/pdf$/u);
  const pdf = await page.request.get(href ?? "");
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
});

test("billing APIs refuse the unauthenticated, and forged webhooks are rejected", async ({
  request,
}) => {
  expect((await request.get("/api/wallet")).status()).toBe(401);
  expect(
    (
      await request.get("/api/invoices/00000000-0000-4000-8000-000000000000/pdf")
    ).status(),
  ).toBe(401);
  const forged = await request.post("/api/webhooks/razorpay", {
    headers: {
      "x-razorpay-signature": "0".repeat(64),
      "x-razorpay-event-id": "evt_forged",
    },
    data: { event: "payment.captured", payload: {} },
  });
  expect(forged.status()).toBe(401);
});
