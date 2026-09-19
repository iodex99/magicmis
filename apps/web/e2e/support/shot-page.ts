/**
 * Full-page screenshots of signed-in pages on the local stack, for looking at a screen rather
 * than reading its code.
 *
 *   pnpm --filter @magicmis/web exec tsx e2e/support/shot-page.ts <outDir> <email> <password> <path>…
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";

const [outDir, email, password, ...paths] = process.argv.slice(2);
if (outDir === undefined || email === undefined || password === undefined)
  throw new Error("usage: shot-page.ts <outDir> <email> <password> <path>…");

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const base = "http://127.0.0.1:3000";
await page.goto(`${base}/sign-in`);
await page.getByLabel("Email").fill(email);
await page.getByLabel("Password").fill(password);
await page.getByRole("button", { name: "Continue" }).click();
await page.waitForURL(/\/app/u);
for (const p of paths) {
  await page.goto(`${base}${p}`);
  await page.waitForTimeout(2500);
  const name = p.replace(/[^a-z0-9]+/giu, "_").replace(/^_|_$/gu, "") || "root";
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
}
await browser.close();
