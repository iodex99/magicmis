/**
 * Phase 2 customer surfaces (SPEC §12, §13): public pricing, wallet with GST shown before
 * payment, bank-transfer proforma with PDF download, price preview, webhook refusal.
 * The Razorpay card flow itself needs live test credentials and is covered by the
 * packages/billing integration tests with a fake gateway.
 */

import { expect, test } from "@playwright/test";

import { createVerifiedAccount, uniqueEmail } from "./helpers";

test("credit packs are public, in dollars, and say nothing of AI cost or where we are", async ({
  page,
}) => {
  await page.goto("/pricing");
  const packs = page.getByTestId("pack-list");
  await expect(packs).toBeVisible();
  await expect(packs.getByTestId("pack")).toHaveCount(6);
  await expect(packs).toContainText("Starter");
  await expect(packs).toContainText("$1,099");
  // ADR 0041: dollar positioning. A visitor abroad is never shown a rupee or a GST rate.
  await expect(page.locator("main")).not.toContainText(/₹|GST|India/u);
  // ADR 0040: per-action credit prices are not public; they live in the wallet.
  await expect(page.getByTestId("price-list")).toHaveCount(0);
  // AI cost and its vocabulary never appear; "KPIs and ratios" in the footer is a guide.
  await expect(page.locator("body")).not.toContainText(
    /cost ratio|ai cost|token|\bmodel\b|fixed price/iu,
  );
});

test("a visitor in India is priced in rupees, the currency they will be billed in", async ({
  page,
}) => {
  // Vercel sets this header; a rupee buyer must not be quoted dollars (ADR 0041).
  await page.setExtraHTTPHeaders({ "x-vercel-ip-country": "IN" });
  await page.goto("/pricing");
  const packs = page.getByTestId("pack-list");
  await expect(packs).toContainText("₹1,00,000");
  await expect(packs).not.toContainText("$");
});

test("the Wallet opens on credit packs with prices and a Buy button, and has no per-action price table (ADR 0050)", async ({
  page,
}) => {
  await createVerifiedAccount(page, uniqueEmail());
  await page.getByRole("link", { name: "Wallet" }).click();
  await expect(page).toHaveURL(/\/wallet$/u);

  // A brand-new account, which has never said where to invoice it, still sees what is for sale.
  const packs = page.getByTestId("wallet-pack");
  await expect(packs).toHaveCount(6);
  await expect(packs.first()).toContainText("$29");
  await expect(packs.first()).toContainText("2,000");
  await expect(packs.first()).toContainText("before tax");
  for (const pack of await packs.all())
    await expect(pack.getByRole("button", { name: "Buy" })).toBeEnabled();
  // The packs come before any form, and before the fold.
  const first = await packs.first().boundingBox();
  expect(first?.y ?? 9999).toBeLessThan(700);
  await expect(page.getByLabel("Address line 1")).toHaveCount(0);

  // The per-action price table is gone from here (the owner's decision), and nothing about
  // what an action costs us is said anywhere on the page.
  await expect(page.getByTestId("price-list")).toHaveCount(0);
  await expect(page.getByText("What each action costs")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(/token|model|AI cost/iu);
  await expect(page.getByTestId("wallet-balance")).toContainText("Credits never expire");

  // It is one quiet link away, still free to read, and still says nothing of what an action costs us.
  await page.getByRole("link", { name: "What actions cost" }).click();
  await expect(page).toHaveURL(/\/wallet\/prices$/u);
  const prices = page.getByTestId("price-list");
  await expect(prices).toContainText("999");
  await expect(prices).not.toContainText(/token|model|ratio|AI cost/iu);
});

test("Buy asks where to invoice once, then goes straight to payment for the pack that was chosen (ADR 0050)", async ({
  page,
}) => {
  await createVerifiedAccount(page, uniqueEmail());
  await page.getByRole("link", { name: "Wallet" }).click();

  // The payment provider is stood in for at the network edge: our own flow runs for real up to
  // the order, and the window that would open is recorded instead of loaded from the internet.
  let ordered: { packId?: string } = {};
  await page.route("**/api/wallet/purchases", async (route) => {
    ordered = route.request().postDataJSON() as { packId?: string };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        purchaseId: "00000000-0000-4000-8000-000000000001",
        orderId: "order_e2e",
        amountMinor: "6900",
        currency: "USD",
        keyId: "rzp_test_e2e",
      }),
    });
  });
  await page.route("https://checkout.razorpay.com/v1/checkout.js", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "window.Razorpay = function (o) { this.open = function () { window.__opened = { key: o.key, order_id: o.order_id, amount: o.amount, currency: o.currency }; o.modal.ondismiss(); }; this.on = function () {}; };",
    }),
  );

  const plus = page.getByTestId("wallet-pack").filter({ hasText: "Plus" });
  await plus.getByRole("button", { name: "Buy" }).click();
  // One step, saying what it is for and which pack is waiting. Abroad, no Indian tax fields.
  await expect(page.getByText("One thing before paying for Plus")).toBeVisible();
  await expect(page.getByLabel("Country")).toHaveValue("US");
  await expect(page.getByLabel(/GSTIN/u)).toHaveCount(0);
  await page.getByLabel("Address line 1").fill("1 Test Street");
  await page.getByLabel("City").fill("Austin");
  await page.getByLabel("Postal code").fill("78701");
  await page.getByRole("button", { name: "Save and continue to payment" }).click();

  // Straight on to payment, for the pack that was chosen, with no second click.
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __opened?: unknown }).__opened),
    )
    .toEqual({
      key: "rzp_test_e2e",
      order_id: "order_e2e",
      amount: "6900",
      currency: "USD",
    });
  const chosen = await page.evaluate(async () => {
    const r = await fetch("/api/wallet");
    const v = (await r.json()) as { packs: { packId: string; name: string | null }[] };
    return v.packs.find((p) => p.name === "Plus")?.packId;
  });
  expect(ordered.packId).toBe(chosen);

  // From now on the cards carry the total and pay in one press.
  await expect(plus.getByRole("button", { name: /^Pay \$69/u })).toBeVisible();
  await expect(plus).toContainText("No tax added");
});

test("wallet shows GST before payment, issues a proforma and serves its PDF", async ({
  page,
}) => {
  await createVerifiedAccount(page, uniqueEmail());
  await page.getByRole("link", { name: "Wallet" }).click();
  await expect(page).toHaveURL(/\/wallet$/u);
  await expect(page.getByTestId("wallet-balance")).toContainText("0");

  // Billing details are asked for at the first purchase rather than at sign-up: the place of
  // supply is needed to work out tax and at no earlier moment. They can also be given ahead.
  await page.getByRole("button", { name: "Add invoice details now" }).click();
  await expect(
    page.getByRole("heading", { name: "Where should we invoice this?" }),
  ).toBeVisible();
  await page.getByLabel("Country").selectOption("IN");
  await page.getByLabel("Address line 1").fill("1 Test Road");
  await page.getByLabel("City").fill("Pune");
  await page.getByLabel("PIN code").fill("411001");
  await page.getByLabel("State").selectOption("27");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // Maharashtra buyer, Maharashtra seller → CGST + SGST shown before paying.
  const row = page.getByTestId("wallet-pack").filter({ hasText: "25,000" }).first();
  await expect(row).toContainText("₹25,000.00 + CGST ₹2,250.00 + SGST ₹2,250.00");
  await expect(row).toContainText("₹29,500.00");
  await expect(row.getByRole("button", { name: "Pay ₹29,500.00" })).toBeEnabled();

  // SPEC §2.3: previewing a price is free and says whether the balance covers it.
  const preview = await page.request.post("/api/pricing/preview", {
    data: { actionKey: "company_setup", tier: "professional", delivery: "standard" },
  });
  expect(preview.status()).toBe(200);
  const body = (await preview.json()) as Record<string, unknown>;
  expect(body).toMatchObject({ credits: "999", available: "0", sufficient: false });
  expect(JSON.stringify(body)).not.toMatch(/cap|ratio|paise/iu);

  await row.getByRole("button", { name: "Pay by bank transfer" }).click();
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
