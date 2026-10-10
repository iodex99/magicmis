/**
 * Every AI action, once, against the real model (ADR 0084) — the check the browser suite cannot
 * make, because it drives a fake model. Spends real money on synthetic data: about a dollar.
 *
 * Seeds two companies through the UI (trading books at Professional, a services business with
 * payroll at Efficient), then presses each priced AI action through the same routes the buttons
 * call — commentary, where to act, and quick, Deep and dashboard-edit chat — plus quick and Deep
 * at Expert. It then reads back from the database what each one charged and what its AI cost, so
 * a stage that fails, quotes, or eats into the margin shows here before a customer finds it.
 *
 * Needs the app on 127.0.0.1:3000 started **without** `AI_TRANSPORT=fake` and with a funded
 * `ANTHROPIC_API_KEY` in its environment, every route activated on the local stack (`pnpm
 * --filter @magicmis/ai activate` lists them), and the fixtures generated. Local only.
 *
 *   pnpm --filter @magicmis/web exec tsx e2e/support/live-smoke.ts
 */

import path from "node:path";

import { chromium, type APIRequestContext, type Page } from "@playwright/test";
import { grantCredits } from "@magicmis/wallet";
import pg from "pg";

import { FIXTURES_OUT } from "../fixtures-setup";
import { createVerifiedAccount, PASSWORD, uniqueEmail } from "../helpers";

// The local Supabase stack's database (supabase/config.toml defaults; not a secret).
const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const APP_URL = "http://127.0.0.1:3000";
const MONTHS = [
  "2025-04",
  "2025-05",
  "2025-06",
  "2025-07",
  "2025-08",
  "2025-09",
  "2025-10",
  "2025-11",
  "2025-12",
  "2026-01",
  "2026-02",
  "2026-03",
  "2026-04",
];
const PERIOD = MONTHS.at(-1) ?? "2026-04";
const ZERO_SIZE = {
  files: 0,
  sheets: 0,
  columns: 0,
  rows: 0,
  distinctLedgerValues: 0,
  referenceMisSheets: 0,
};
type Tier = "efficient" | "professional" | "expert";

interface Outcome {
  readonly company: string;
  readonly tier: Tier;
  readonly action: string;
  readonly result: string;
  readonly detail: string;
}

const pool = new pg.Pool({ connectionString: LOCAL_DB, max: 2 });
const browser = await chromium.launch();
const outcomes: Outcome[] = [];
const say = (line: string) => process.stdout.write(`${line}\n`);
const key = () => crypto.randomUUID();
/** An integer in minor units as a decimal string, exactly: money never goes through a float. */
const scaled = (minor: bigint, places: number, symbol: string): string => {
  const unit = 10n ** BigInt(places);
  const sign = minor < 0n ? "-" : "";
  const abs = minor < 0n ? -minor : minor;
  return `${sign}${symbol}${(abs / unit).toString()}.${(abs % unit).toString().padStart(places, "0")}`;
};

async function setUp(
  page: Page,
  name: string,
  tier: Tier,
  files: readonly string[],
): Promise<string> {
  await page.goto("/app");
  await page.getByLabel("Company name").fill(name);
  await page.getByRole("button", { name: "Add company" }).click();
  await page.waitForURL(/\/app\/companies\/[0-9a-f-]+$/u);
  const companyId = page.url().split("/").pop() ?? "";
  await page.getByLabel("Choose files", { exact: true }).setInputFiles([...files]);
  // The tier sits under its own disclosure, which names the tier chosen, folded away because
  // most people never change it.
  await page.getByRole("button", { name: /^Intelligence tier:/u }).click();
  await page.getByLabel("Intelligence tier").selectOption(tier);
  await page.getByTestId("job-run").click({ timeout: 180_000 });
  await page.getByTestId("job-done").waitFor({ timeout: 600_000 });
  const done = ((await page.getByTestId("job-done").textContent()) ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  outcomes.push({
    company: name,
    tier,
    action: "setup run",
    result: "done",
    detail: done,
  });
  return companyId;
}

/** Create the job and hold its credits, as `startPaidJob` does in the browser. */
async function hold(
  api: APIRequestContext,
  companyId: string,
  type: "commentary" | "board_actions",
  tier: Tier,
): Promise<string> {
  const created = await api.post("/api/jobs", {
    data: { companyId, type, tier, size: ZERO_SIZE, fingerprints: {} },
    headers: { "idempotency-key": key() },
  });
  const job = (await created.json()) as {
    jobId?: string;
    quote?: unknown;
    error?: string;
  };
  if (!created.ok() || job.jobId === undefined)
    throw new Error(
      `${type}: create HTTP ${String(created.status())} ${job.error ?? ""}`,
    );
  if (job.quote !== null && job.quote !== undefined)
    throw new Error(`${type}: asked for a quote at the standard price`);
  const confirmed = await api.post(`/api/jobs/${job.jobId}/confirm`, {
    data: {},
    headers: { "idempotency-key": key() },
  });
  if (!confirmed.ok())
    throw new Error(`${type}: hold HTTP ${String(confirmed.status())}`);
  return job.jobId;
}

async function documentAction(
  api: APIRequestContext,
  company: string,
  companyId: string,
  kind: "commentary" | "board_actions",
  tier: Tier,
): Promise<void> {
  const route = kind === "commentary" ? "commentary" : "board-actions";
  try {
    const jobId = await hold(api, companyId, kind, tier);
    const r = await api.post(`/api/jobs/${jobId}/${route}`, {
      data: { period: PERIOD },
      headers: { "idempotency-key": key() },
      timeout: 300_000,
    });
    const body = (await r.json()) as { state?: string; error?: string };
    const shown = await api.get(`/api/jobs/${jobId}/${route}`);
    const text = JSON.stringify(await shown.json());
    outcomes.push({
      company,
      tier,
      action: kind === "commentary" ? "commentary" : "where to act",
      result: body.state ?? `HTTP ${String(r.status())} ${body.error ?? ""}`,
      detail: excerpt(text),
    });
  } catch (error) {
    outcomes.push({
      company,
      tier,
      action: kind,
      result: "error",
      detail: String(error),
    });
  }
}

async function chat(
  api: APIRequestContext,
  company: string,
  companyId: string,
  tier: Tier,
  type: "quick" | "deep" | "edit",
  text: string,
): Promise<void> {
  const r = await api.post("/api/chat/messages", {
    data: {
      companyId,
      threadId: null,
      type,
      tier,
      text,
      ...(type === "edit" ? { editTarget: "dashboard" } : {}),
    },
    headers: { "idempotency-key": key() },
    timeout: 300_000,
  });
  const body = (await r.json()) as {
    progress?: { status?: string };
    error?: string;
  };
  outcomes.push({
    company,
    tier,
    action: `chat ${type}`,
    result: body.progress?.status ?? `HTTP ${String(r.status())} ${body.error ?? ""}`,
    detail: excerpt(JSON.stringify(body.progress ?? body)),
  });
}

/** The first readable sentence of a payload, for a person to eyeball. */
function excerpt(json: string): string {
  const texts = [
    ...json.matchAll(/"(?:text|summary|heading|answer)":"((?:[^"\\]|\\.){20,})"/gu),
  ]
    .map((m) => m[1] ?? "")
    .filter((t) => t.length > 0);
  return (texts[0] ?? json).slice(0, 220);
}

try {
  await pool.query(`delete from auth_throttle where key like 'signup:ip:%'`);
  // The fixtures are Indian books, so the account comes from India, as Vercel would say: the
  // first company then opens on an April year in rupees (ADR 0084), not a calendar year.
  const context = await browser.newContext({
    baseURL: APP_URL,
    extraHTTPHeaders: { "x-vercel-ip-country": "IN" },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(180_000);
  const email = uniqueEmail();

  say("signing up…");
  await createVerifiedAccount(page, email);
  const consent = await page.request.post("/api/account/consents", {
    data: { document: "processing" },
    headers: { "idempotency-key": key() },
  });
  if (!consent.ok()) throw new Error(`consent failed: HTTP ${String(consent.status())}`);
  const account = await pool.query<{ id: string }>(
    `select id from accounts where email = $1`,
    [email],
  );
  const accountId = account.rows[0]?.id;
  if (accountId === undefined) throw new Error("account row not found");
  // Razorpay needs live test keys locally (R-26), so fund the way an admin grant would.
  await grantCredits(pool, {
    accountId,
    credits: 50_000n,
    source: "admin_grant",
    idempotencyKey: key(),
  });
  const started = new Date();

  const trading = "Northwind Hardware Traders";
  say(`setting up ${trading} at Professional…`);
  const tradingId = await setUp(
    page,
    trading,
    "professional",
    MONTHS.map((m) =>
      path.join(FIXTURES_OUT, "trading", "clean", `trial_balance_${m}.xlsx`),
    ),
  );

  const services = "Lakeside Advisory Services";
  say(`setting up ${services} at Efficient…`);
  const servicesId = await setUp(page, services, "efficient", [
    ...MONTHS.map((m) =>
      path.join(FIXTURES_OUT, "services", "clean", `trial_balance_${m}.xlsx`),
    ),
    ...MONTHS.map((m) =>
      path.join(FIXTURES_OUT, "services", "clean", `pay_sheet_${m}.csv`),
    ),
  ]);

  const api = page.request;
  for (const [company, id, tier] of [
    [trading, tradingId, "professional"],
    [services, servicesId, "efficient"],
  ] as const) {
    say(`${company} (${tier}): commentary, where to act, chat…`);
    await documentAction(api, company, id, "commentary", tier);
    await documentAction(api, company, id, "board_actions", tier);
    await chat(api, company, id, tier, "quick", "How did revenue move this month?");
    await chat(
      api,
      company,
      id,
      tier,
      "deep",
      "Which three expense ledgers grew the most over the last three months?",
    );
    await chat(
      api,
      company,
      id,
      tier,
      "edit",
      "Add a chart of revenue for the last six months.",
    );
  }
  say(`${trading} (expert): chat…`);
  await chat(
    api,
    trading,
    tradingId,
    "expert",
    "quick",
    "How did revenue move this month?",
  );
  await chat(
    api,
    trading,
    tradingId,
    "expert",
    "deep",
    "Which customers owe us the most, and how long have they owed it?",
  );

  // What each action actually cost against what it charged.
  const calls = await pool.query<{
    stage: string;
    model_used: string;
    status: string;
    calls: number;
    usd_micro: string;
    inr_paise: string;
  }>(
    `select stage, model_used, status, count(*)::int calls,
            sum(usd_cost_micro)::text usd_micro, sum(inr_cost_paise)::text inr_paise
       from ai_calls where account_id = $1 and created_at >= $2
      group by 1, 2, 3 order by 1, 2, 3`,
    [accountId, started],
  );
  const spent = await pool.query<{ captured: string }>(
    `select coalesce(sum(abs(amount)), 0)::text captured from credit_ledger
      where account_id = $1 and created_at >= $2 and entry_type = 'capture'`,
    [accountId, started],
  );

  say("");
  say("=== actions ===");
  for (const o of outcomes)
    say(`${o.tier.padEnd(12)} ${o.action.padEnd(14)} ${o.result.padEnd(10)} ${o.detail}`);
  say("");
  say("=== AI calls ===");
  let usd = 0n;
  let paise = 0n;
  for (const c of calls.rows) {
    usd += BigInt(c.usd_micro);
    paise += BigInt(c.inr_paise);
    say(
      `${c.stage.padEnd(20)} ${c.model_used.padEnd(18)} ${c.status.padEnd(15)} ${String(c.calls).padStart(3)} calls  ${scaled(BigInt(c.usd_micro), 6, "$")}`,
    );
  }
  const credits = BigInt(spent.rows[0]?.captured ?? "0");
  say("");
  say(`credits captured: ${credits.toString()}`);
  say(`AI cost:          ${scaled(usd, 6, "$")} (${scaled(paise, 2, "₹")})`);
  if (credits > 0n)
    say(`AI cost / price:  ${scaled((paise * 10_000n) / (credits * 100n), 2, "")}%`);
  say("");
  say(`sign in: ${email} / ${PASSWORD}`);
} finally {
  await browser.close();
  await pool.end();
}
