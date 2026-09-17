/**
 * Phase 3 browser acceptance (SPEC §15, §17, §33, §34): files are parsed in a Web Worker and
 * loaded into DuckDB-WASM; before payment only names, sizes, sheet counts and row counts are
 * shown; session data clears; any file format is read or refused with a reason (ADR 0031);
 * a 50 MB workbook loads in under 60 seconds.
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

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  csp = watchCspViolations(page);
  await createVerifiedAccount(page, uniqueEmail());
  // SPEC §31: the first upload in an account waits for the processing notice to be accepted.
  await page.goto("/app/data");
  await expect(page.getByTestId("processing-notice")).toBeVisible();
  await expect(page.getByLabel("Source files")).toHaveCount(0);
  await page.getByRole("button", { name: /I understand/u }).click();
  await expect(page.getByLabel("Source files")).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel("Source files")).toBeEnabled();
  await expect(page.getByTestId("processing-notice")).toHaveCount(0);
});

test.afterAll(async () => {
  await page.close();
});

async function openData() {
  await page.goto("/app/data");
  await expect(page.getByLabel("Source files")).toBeEnabled();
  if (await page.getByTestId("loaded-files").isVisible()) {
    await page.getByRole("button", { name: "Clear session data" }).click();
    await expect(page.getByText("No files loaded.")).toBeVisible();
  }
}

test("files load in the browser and only names, sizes, sheets and rows are shown before payment", async () => {
  await openData();
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") requests.push(`${r.method()} ${r.url()}`);
  });

  const tb = fixture("trading", "clean", "trial_balance_2025-04.xlsx");
  const register = fixture("trading", "clean", "sales_register_2025-04.csv");
  await page.getByLabel("Source files").setInputFiles([tb, register]);

  const table = page.getByTestId("loaded-files");
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(table).toContainText("trial_balance_2025-04.xlsx");
  await expect(table).toContainText("sales_register_2025-04.csv");
  await expect(table.getByRole("row", { name: /trial_balance/u })).toContainText(
    `${(statSync(tb).size / 1024).toFixed(0)} KB`,
  );

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
  // Raw files never leave the browser: no request carried a body while loading.
  expect(requests.filter((r) => !r.includes("/_next/"))).toEqual([]);

  await page.getByRole("button", { name: "Clear session data" }).click();
  await expect(page.getByText("No files loaded")).toBeVisible();
});

test("a photo is refused with what to export instead, and other formats are read", async () => {
  await openData();
  await page.getByLabel("Source files").setInputFiles({
    name: "trial balance.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  });
  await expect(page.getByTestId("ingest-progress")).toContainText(
    "Export the report from your accounting software as Excel, CSV or PDF",
  );

  // A tab-separated export saved as .txt, from a system that is not Tally.
  await page.getByLabel("Source files").setInputFiles({
    name: "TB March 2026.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Account\tDebit\tCredit\nCash\t1500\t\nSales\t\t1500\n"),
  });
  await expect(page.getByTestId("loaded-files").getByRole("row")).toHaveCount(2);
  await expect(page.getByTestId("loaded-files")).toContainText("TB March 2026.txt");
});

test("a text PDF of a trial balance is read in the browser", async () => {
  await openData();
  // A minimal valid PDF: pdf.js runs inside the ingestion worker, so this proves the bundled
  // parser loads there under the page's CSP, not only under Node.
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

  await page.getByLabel("Source files").setInputFiles({
    name: "tb.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(pdf, "latin1"),
  });
  await expect(page.getByTestId("loaded-files")).toContainText("tb.pdf");
  expect(csp).toEqual([]);
});

test("the drop zone reacts while a file is dragged over it", async () => {
  await openData();
  const zone = page.getByRole("button", { name: "Drag your exports here" });
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

test("a 50 MB workbook is parsed and loaded into DuckDB in under 60 seconds (SPEC §33)", async () => {
  test.setTimeout(240_000);
  const large = fixture("perf", "large-day-book.xlsx");
  expect(statSync(large).size).toBeGreaterThan(49 * 1024 * 1024);
  await openData();

  const started = Date.now();
  await page.getByLabel("Source files").setInputFiles(large);
  await expect(page.getByTestId("loaded-files")).toContainText("large-day-book.xlsx", {
    timeout: 90_000,
  });
  const elapsed = Date.now() - started;
  console.warn(`50 MB workbook loaded in ${(elapsed / 1000).toFixed(1)} s`);
  await expect(page.getByTestId("loaded-files")).toContainText("3,70,004");
  expect(elapsed).toBeLessThan(60_000);
});

test("pages carry a per-request nonce CSP and hardening headers (SPEC §30)", async () => {
  const first = await page.request.get("/app/data");
  const second = await page.request.get("/app/data");
  const policy = first.headers()["content-security-policy"] ?? "";
  expect(policy).toMatch(/script-src [^;]*'nonce-[A-Za-z0-9+/=]+'/u);
  expect(policy).not.toContain("razorpay");
  expect(policy).not.toBe(second.headers()["content-security-policy"]);
  expect(first.headers()["x-frame-options"]).toBe("DENY");
  expect(first.headers()["x-content-type-options"]).toBe("nosniff");
  // The payment gateway is allowed on exactly two paths: the Wallet, and the run screen,
  // which takes the payment in place so a run does not lose its loaded files (R-57).
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
  for (const path of ["/app", "/settings/security", "/pricing"]) {
    const other = await page.request.get(path);
    expect(other.headers()["content-security-policy"], path).not.toContain("razorpay");
  }
});

test("no Content Security Policy violations anywhere in the flow (SPEC §30)", () => {
  expect(csp).toEqual([]);
});
