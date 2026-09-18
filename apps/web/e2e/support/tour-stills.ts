/**
 * Stills of the product tour at given seconds, for checking a scene before rendering the film
 * (`record-tour.ts` takes minutes; this takes seconds).
 *
 *   pnpm --filter @magicmis/web exec tsx e2e/support/tour-stills.ts <outDir> 31.2 33.9
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const page = path.join(
  here,
  "..",
  "..",
  "..",
  "..",
  "docs",
  "brand",
  "explainer",
  "index.html",
);
const [outDir, ...times] = process.argv.slice(2);
if (outDir === undefined || times.length === 0)
  throw new Error("usage: tour-stills.ts <outDir> <seconds>…");

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await tab.goto(`${pathToFileURL(page).href}?still`);
await tab.evaluate(() => document.fonts.ready);
for (const t of times) {
  await tab.evaluate((at) => {
    (window as unknown as { __seek: (t: number) => void }).__seek(at);
  }, Number.parseFloat(t));
  await tab.screenshot({ path: path.join(outDir, `tour-${t}.png`) });
}
await browser.close();
