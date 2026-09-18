/**
 * File intake acceptance (SPEC §15, §33, ADR 0031, ADR 0032): files are uploaded in chunks, sealed
 * on arrival and read on the server; before payment only names, sizes, sheet counts and row counts
 * are shown; any format is read or refused with a reason; a 50 MB workbook is in and read in under
 * a minute; uploaded files can be seen and deleted.
 */

import { statSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { FIXTURES_OUT } from "./fixtures-setup";
import { createVerifiedAccount, uniqueEmail, watchCspViolations } from "./helpers";

const fixture = (...parts: string[]) => path.join(FIXTURES_OUT, ...parts);

// One account for the whole file: sign-ups are rate-limited by the local Auth server.
test.describe.configure({ mode: "serial" });
let page: Page;
let csp: string[] = [];
let runUrl = "";

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  csp = watchCspViolations(page);
  await createVerifiedAccount(page, uniqueEmail());
  await page.goto("/app");
  await page.getByLabel("Company name").fill("Intake Test Traders");
  await page.getByRole("button", { name: "Add company" }).click();
  await expect(page).toHaveURL(/\/app\/companies\/[0-9a-f-]+$/u);
  runUrl = page.url();
  // SPEC §31: the first upload in an account waits for the processing notice to be accepted.
  await expect(page.getByTestId("processing-notice")).toBeVisible();
  await expect(page.getByLabel("Choose files")).toHaveCount(0);
  await page.getByRole("button", { name: /I understand/u }).click();
  await expect(page.getByLabel("Choose files")).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel("Choose files")).toBeEnabled();
  await expect(page.getByTestId("processing-notice")).toHaveCount(0);
});

test.afterAll(async () => {
  await page.close();
});

async function openRun() {
  await page.goto(runUrl);
  await expect(page.getByLabel("Choose files")).toBeEnabled();
}

test("files upload and only names, sizes, sheets and rows are shown before payment", async () => {
  await openRun();
  const tb = fixture("trading", "clean", "trial_balance_2025-04.xlsx");
  const register = fixture("trading", "clean", "sales_register_2025-04.csv");
  await page.getByLabel("Choose files").setInputFiles([tb, register]);

  const table = page.getByTestId("job-files");
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(table).toContainText("trial_balance_2025-04.xlsx");
  await expect(table).toContainText("sales_register_2025-04.csv");
  await expect(table.getByRole("row", { name: /trial_balance/u })).toContainText(
    `${Math.ceil(statSync(tb).size / 1024).toString()} KB`,
  );
  await expect(page.getByTestId("job-run")).toBeEnabled({ timeout: 60_000 });

  // SPEC §2.3: no recognition results before payment.
  const body = page.locator("main");
  for (const leak of [
    "Trial Balance",
    "Sales Register",
    "Sundry Debtors",
    "Northwind",
    "Synthetic Hardware",
  ]) {
    await expect(body).not.toContainText(leak);
  }
});

test("a photo is refused with what to export instead, and other formats are read", async () => {
  await openRun();
  await page.getByLabel("Choose files").setInputFiles([
    {
      name: "trial balance.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    },
    {
      name: "TB March 2026.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Account\tDebit\tCredit\nCash\t1500\t\nSales\t\t1500\n"),
    },
  ]);
  const table = page.getByTestId("job-files");
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(page.getByTestId("job-file-problem")).toContainText(
    "Export the report from your accounting software as Excel, CSV or PDF",
    { timeout: 30_000 },
  );
  await expect(table.getByRole("row", { name: /TB March 2026/u })).toContainText("3");
});

test("a text PDF of a trial balance is read", async () => {
  await openRun();
  const lines: [string, number, number][] = [
    ["Trial Balance as at 31-Mar-2026", 40, 760],
    ["Particulars", 40, 720],
    ["Debit", 300, 720],
    ["Credit", 400, 720],
    ["Cash", 40, 700],
    ["1,000.00", 290, 700],
    ["Capital", 40, 680],
    ["1,000.00", 390, 680],
  ];
  const content = lines
    .map(([t, x, y]) => `BT /F1 10 Tf ${x.toString()} ${y.toString()} Td (${t}) Tj ET`)
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length.toString()} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${(i + 1).toString()} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${(objects.length + 1).toString()}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${o.toString().padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${(objects.length + 1).toString()} /Root 1 0 R >>\nstartxref\n${xref.toString()}\n%%EOF`;

  await page.getByLabel("Choose files").setInputFiles({
    name: "tb.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(pdf, "latin1"),
  });
  const row = page.getByTestId("job-files").getByRole("row", { name: /tb\.pdf/u });
  await expect(row).toBeVisible();
  await expect(page.getByTestId("job-run")).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByTestId("job-file-problem")).toHaveCount(0);
});

test("the drop zone reacts while a file is dragged over it", async () => {
  await openRun();
  const zone = page.getByRole("button", { name: "Drag your trial balances here" });
  const data = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["a,b"], "x.csv", { type: "text/csv" }));
    return dt;
  });
  await zone.dispatchEvent("dragenter", { dataTransfer: data });
  await expect(page.getByText("Drop to add")).toBeVisible();
  await expect(zone).toHaveAttribute("data-dragging", "true");
  await zone.dispatchEvent("dragleave", { dataTransfer: data });
  await expect(page.getByText("Drop to add")).toHaveCount(0);
});

test("a 50 MB workbook is uploaded and read in under 60 seconds (SPEC §33)", async () => {
  test.setTimeout(240_000);
  const large = fixture("perf", "large-day-book.xlsx");
  expect(statSync(large).size).toBeGreaterThan(49 * 1024 * 1024);
  await openRun();

  const started = Date.now();
  await page.getByLabel("Choose files").setInputFiles(large);
  const row = page.getByTestId("job-files").getByRole("row", { name: /large-day-book/u });
  await expect(row).toContainText("370,004", { timeout: 90_000 });
  const elapsed = Date.now() - started;
  console.warn(`50 MB workbook uploaded and read in ${(elapsed / 1000).toFixed(1)} s`);
  expect(elapsed).toBeLessThan(60_000);
});

test("a company's kept files are listed with their deletion date and can be deleted now", async () => {
  await page.goto(runUrl);
  await page.getByTestId("kept-files").locator("summary").click();
  const table = page.getByTestId("uploaded-files");
  await expect(table).toContainText("trial_balance_2025-04.xlsx");
  const row = table.getByRole("row", { name: /tb\.pdf/u });
  await row.getByRole("button", { name: "Delete now" }).click();
  await expect(table.getByRole("row", { name: /tb\.pdf/u })).toHaveCount(0);
  await page.reload();
  await page.getByTestId("kept-files").locator("summary").click();
  await expect(page.getByTestId("uploaded-files")).not.toContainText("tb.pdf");
});

test("pages carry a per-request nonce CSP and hardening headers (SPEC §30)", async () => {
  const first = await page.request.get("/app");
  const second = await page.request.get("/app");
  const policy = first.headers()["content-security-policy"] ?? "";
  expect(policy).toMatch(/script-src [^;]*'nonce-[A-Za-z0-9+/=]+'/u);
  expect(policy).not.toContain("razorpay");
  expect(policy).not.toBe(second.headers()["content-security-policy"]);
  expect(first.headers()["x-frame-options"]).toBe("DENY");
  expect(first.headers()["x-content-type-options"]).toBe("nosniff");
  // The payment gateway is allowed only on the Wallet and the two screens that start a run
  // and take the payment in place — the company workspace and Add a month (R-57, ADR 0033).
  const wallet = await page.request.get("/wallet");
  expect(wallet.headers()["content-security-policy"]).toContain(
    "frame-src https://*.razorpay.com",
  );
  const run = await page.request.get(
    "/app/companies/00000000-0000-4000-8000-000000000000/run",
  );
  expect(run.headers()["content-security-policy"]).toContain(
    "frame-src https://*.razorpay.com",
  );
  const workspace = await page.request.get(
    "/app/companies/00000000-0000-4000-8000-000000000000",
  );
  expect(workspace.headers()["content-security-policy"]).toContain(
    "frame-src https://*.razorpay.com",
  );
  for (const p of ["/app", "/settings/security", "/pricing"]) {
    const other = await page.request.get(p);
    expect(other.headers()["content-security-policy"], p).not.toContain("razorpay");
  }
});

test("no Content Security Policy violations anywhere in the flow (SPEC §30)", () => {
  expect(csp).toEqual([]);
});
