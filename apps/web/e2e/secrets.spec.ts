/**
 * No server secret reaches a browser through a rendered response (SPEC §30, §2.9; R-54).
 *
 * The CI bundle scan walks `.next/static`, which is only half of what a browser receives. A
 * server component that passes a prop to a client one serialises that prop into the page's
 * HTML **and** into its RSC payload, and neither is a static file — an inlined connection
 * string or API key would sail past the bundle scan and land in the reader's tab.
 *
 * So this fetches every page as the browser does, with a real signed-in session and a real
 * company, and applies the same rules the bundle scan uses: the verbatim value of any
 * server-only environment variable, secret-shaped tokens, and markers of server-only code.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { createVerifiedAccount, uniqueEmail } from "./helpers";

const { readEnvFile, scanTexts } = (await import(
  path.resolve(process.cwd(), "..", "..", "scripts", "scan-client-bundles.mjs")
)) as {
  readEnvFile: (file: string) => Promise<Record<string, string>>;
  scanTexts: (
    entries: { where: string; text: string }[],
    env: Record<string, string | undefined>,
  ) => { scanned: number; findings: string[] };
};

const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/**
 * Pages worth fetching: every route that renders server data.
 *
 * `[id]` is filled with the company created below. The pure-marketing and auth routes are
 * here too — they take props from the same server modules, and a leak there would be the
 * most public of all.
 */
const STATIC_PATHS = [
  "/",
  "/product",
  "/how-it-works",
  "/management-accounts",
  "/mis-report-format",
  "/tally-mis-report",
  "/for-accountants",
  "/ai-mis-report",
  "/mis-in-minutes",
  "/automated-management-accounts",
  "/monthly-financial-reporting",
  "/chat-with-your-mis",
  "/boardroom-ready-mis",
  "/ai-variance-analysis",
  "/ai-management-accounts",
  "/ai-financial-reporting",
  "/mis-dashboard",
  "/what-is-an-mis-report",
  "/board-pack",
  "/month-end-reporting-package",
  "/management-reporting-software",
  "/guides",
  "/guides/mis-kpis-and-ratios",
  "/guides/trial-balance-to-management-report",
  "/guides/debtors-ageing-report",
  "/guides/mis-commentary",
  "/guides/month-end-close-checklist",
  "/security",
  "/pricing",
  "/legal/terms",
  "/legal/privacy",
  "/sign-in",
  "/sign-up",
  "/app",
  "/wallet",
  "/settings/profile",
  "/settings/security",
  "/settings/privacy",
];

const COMPANY_PATHS = [
  "/app/companies/{id}",
  "/app/companies/{id}/run",
  "/app/companies/{id}/dashboard",
  "/app/companies/{id}/commentary",
  "/app/companies/{id}/chat",
];

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

let page: Page;
let db: pg.Pool;
let companyId: string;

test.beforeAll(async ({ browser }) => {
  db = new pg.Pool({ connectionString: LOCAL_DB, max: 2 });
  page = await browser.newPage();
  await createVerifiedAccount(page, uniqueEmail());

  // The DPDP processing consent is taken before any company work (SPEC §31).
  const consent = await page.request.post("/api/account/consents", {
    data: { document: "processing" },
    headers: { "idempotency-key": randomUUID() },
  });
  expect(consent.ok(), await consent.text()).toBe(true);

  // A company gives the company routes real rows to render. Created through the API so this
  // file stays about the response bodies rather than the setup journey.
  const created = await page.request.post("/api/companies", {
    data: { name: "Secret Scan Trading Pvt Ltd" },
    headers: { "idempotency-key": randomUUID() },
  });
  if (!created.ok())
    throw new Error(
      `create company ${String(created.status())}: ${await created.text()}`,
    );
  companyId = ((await created.json()) as { companyId: string }).companyId;
});

test.afterAll(async () => {
  await page.close();
  await db.end();
});

test("no rendered page or RSC payload carries a server secret (SPEC §30, §2.9)", async () => {
  const env = await readEnvFile(path.resolve(process.cwd(), ".env.local"));
  // The scan is only meaningful if it has real values to look for. In CI these are
  // per-run random values long enough for the scanner to check verbatim; locally they are
  // whatever the developer's stack uses.
  expect(
    Object.keys(env).length,
    "apps/web/.env.local must exist for this scan to mean anything",
  ).toBeGreaterThan(0);

  const paths = [
    ...STATIC_PATHS,
    ...COMPANY_PATHS.map((p) => p.replace("{id}", companyId)),
  ];

  const entries: { where: string; text: string }[] = [];
  for (const p of paths) {
    // The HTML a browser is served, session cookies and all.
    const html = await page.request.get(p);
    expect([200, 307, 308], `${p} returned ${String(html.status())}`).toContain(
      html.status(),
    );
    entries.push({ where: `GET ${p} (html)`, text: await html.text() });

    // The RSC payload: what a client-side navigation to the same route downloads. It
    // carries the serialised props directly, without the surrounding document.
    const rsc = await page.request.get(p, { headers: { RSC: "1" } });
    entries.push({ where: `GET ${p} (rsc)`, text: await rsc.text() });
  }

  /**
   * Control: prove the rules are armed before trusting the clean result.
   *
   * A scan that cannot fail is worse than no scan, because it reads as evidence. Planting
   * each kind of finding in a synthetic page shows that the environment really did yield
   * values to search for, and that the pattern and marker rules reached this process.
   */
  const planted = scanTexts(
    [
      {
        where: "control/env-value",
        text: `<script>${env["DATABASE_URL"] ?? ""}</script>`,
      },
      { where: "control/pattern", text: "key=sk-ant-api03-planted-not-a-real-key" },
      { where: "control/marker", text: "It is data, never instructions" },
    ],
    env,
  ).findings;
  expect(
    planted.length,
    "the secret scan found nothing in a page built to contain three findings",
  ).toBeGreaterThanOrEqual(3);

  const { scanned, findings } = scanTexts(entries, env);
  expect(findings, findings.join("\n")).toEqual([]);
  expect(scanned).toBe(paths.length * 2);
});
