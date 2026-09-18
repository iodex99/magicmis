/**
 * Screenshots of the demo company's workspace, for looking at a change rather than reading it:
 * the dashboard with the chat, then Present. Signs in to the local stack as the seeded demo
 * account (see `seed-demo.ts`).
 *
 *   pnpm --filter @magicmis/web exec tsx e2e/support/shot-demo.ts <outDir> <email> <password> <companyId> [ask…]
 *
 * Each `ask` is sent to the chat before the screenshots are taken, and costs the demo account
 * its credits like any other message.
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";

const [outDir, email, password, companyId, ...asks] = process.argv.slice(2);
if (
  outDir === undefined ||
  email === undefined ||
  password === undefined ||
  companyId === undefined
)
  throw new Error("usage: shot-demo.ts <outDir> <email> <password> <companyId> [ask…]");

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const base = "http://127.0.0.1:3000";

await page.goto(`${base}/sign-in`);
await page.getByLabel("Email").fill(email);
await page.getByLabel("Password").fill(password);
await page.getByRole("button", { name: "Continue" }).click();
await page.waitForURL(/\/app/u);
await page.goto(`${base}/app/companies/${companyId}`);
await page.getByTestId("widget-kpi_revenue").waitFor();

for (const ask of asks) {
  await page.getByLabel("Your question").fill(ask);
  await page.getByTestId("chat-send").click();
  await page.getByTestId("chat-send").waitFor({ state: "visible" });
  await page.waitForFunction(
    () => document.querySelector("[data-testid='chat-send']:not([disabled])") === null,
  );
  await page
    .getByText(/Done\. It is on the dashboard|could not be answered/u)
    .last()
    .waitFor();
}
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(outDir, "workspace.png"), fullPage: true });

await page.getByTestId("present").click();
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(outDir, "present.png") });
await browser.close();
