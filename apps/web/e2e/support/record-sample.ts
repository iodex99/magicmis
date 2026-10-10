/**
 * Records the sample company (ADR 0086): one invented business, set up through the UI from
 * thirteen months of synthetic trial balances and pay sheets at Professional, with the latest month's
 * commentary and where to act written by the real model — then saved as the file the sample
 * page reads, so looking at the sample never calls a model or charges anyone.
 *
 * Run it again when the board, the engine or a prompt has moved far enough that the sample
 * should show it; the unit test beside the file checks every figure placeholder in it still
 * resolves. Spends real money on synthetic data: well under a dollar.
 *
 * Needs the app on 127.0.0.1:3000 started **without** `AI_TRANSPORT=fake` and with a funded
 * `ANTHROPIC_API_KEY` in its environment, the routes activated on the local stack, and the
 * fixtures generated. Local only.
 *
 *   pnpm --filter @magicmis/web exec tsx e2e/support/record-sample.ts
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium, type APIRequestContext } from "@playwright/test";
import { grantCredits } from "@magicmis/wallet";
import pg from "pg";

import { FIXTURES_OUT } from "../fixtures-setup";
import { createVerifiedAccount, uniqueEmail } from "../helpers";

// The local Supabase stack's database (supabase/config.toml defaults; not a secret).
const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const APP_URL = "http://127.0.0.1:3000";
const OUT = path.join(
  import.meta.dirname,
  "..",
  "..",
  "src",
  "lib",
  "sample-company.json",
);

/** Invented, and said to be on the page that shows it. */
const NAME = "Kestrel Advisory LLP";
const TRADE = "Professional services";

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
// The services books, not the trading ones: the trading fixture's stock swings by more than a
// month's sales so that the ingestion tests meet hard cases, which made direct costs negative in
// five months and had the model rightly calling the sample's own books anomalous. The services
// firm's fees and margin slip steadily over the year — a story worth reading — and its pay
// sheets put payroll on the board.
const files = (month: string) => [
  path.join(FIXTURES_OUT, "services", "clean", `trial_balance_${month}.xlsx`),
  path.join(FIXTURES_OUT, "services", "clean", `pay_sheet_${month}.csv`),
];

const pool = new pg.Pool({ connectionString: LOCAL_DB, max: 2 });
const browser = await chromium.launch();
const say = (line: string) => process.stdout.write(`${line}\n`);
const key = () => crypto.randomUUID();

async function json<T>(api: APIRequestContext, url: string): Promise<T> {
  const r = await api.get(url);
  if (!r.ok()) throw new Error(`${url}: HTTP ${String(r.status())}`);
  return (await r.json()) as T;
}

/** Hold, run and read back one written action, as the assistant's buttons do. */
async function written(
  api: APIRequestContext,
  companyId: string,
  type: "commentary" | "board_actions",
): Promise<Record<string, unknown>> {
  const route = type === "commentary" ? "commentary" : "board-actions";
  const created = await api.post("/api/jobs", {
    data: { companyId, type, tier: "professional", size: ZERO_SIZE, fingerprints: {} },
    headers: { "idempotency-key": key() },
  });
  const job = (await created.json()) as { jobId?: string; quote?: unknown };
  if (!created.ok() || job.jobId === undefined)
    throw new Error(`${type}: create HTTP ${String(created.status())}`);
  if (job.quote !== null && job.quote !== undefined)
    throw new Error(`${type}: asked for a quote at the standard price`);
  const held = await api.post(`/api/jobs/${job.jobId}/confirm`, {
    data: {},
    headers: { "idempotency-key": key() },
  });
  if (!held.ok()) throw new Error(`${type}: hold HTTP ${String(held.status())}`);
  const ran = await api.post(`/api/jobs/${job.jobId}/${route}`, {
    data: { period: PERIOD },
    headers: { "idempotency-key": key() },
    timeout: 300_000,
  });
  const state = ((await ran.json()) as { state?: string }).state;
  if (state !== "completed") throw new Error(`${type}: ${state ?? "no state"}`);
  return json(api, `/api/jobs/${job.jobId}/${route}`);
}

try {
  await pool.query(`delete from auth_throttle where key like 'signup:ip:%'`);
  const context = await browser.newContext({
    baseURL: APP_URL,
    extraHTTPHeaders: { "x-vercel-ip-country": "IN" },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);

  say("signing up…");
  const email = uniqueEmail();
  await createVerifiedAccount(page, email);
  const consent = await page.request.post("/api/account/consents", {
    data: { document: "processing" },
    headers: { "idempotency-key": key() },
  });
  if (!consent.ok()) throw new Error(`consent: HTTP ${String(consent.status())}`);
  const account = await pool.query<{ id: string }>(
    `select id from accounts where email = $1`,
    [email],
  );
  const accountId = account.rows[0]?.id;
  if (accountId === undefined) throw new Error("account row not found");
  await grantCredits(pool, {
    accountId,
    credits: 20_000n,
    source: "admin_grant",
    idempotencyKey: key(),
  });

  say(`setting up ${NAME} from ${MONTHS.length.toString()} months…`);
  await page.goto("/app");
  await page.getByLabel("Company name").fill(NAME);
  await page.getByRole("button", { name: "Add company" }).click();
  await page.waitForURL(/\/app\/companies\/[0-9a-f-]+$/u);
  const companyId = page.url().split("/").pop() ?? "";
  await page.getByLabel("Choose files").setInputFiles(MONTHS.flatMap(files));
  await page.getByTestId("job-run").click({ timeout: 180_000 });
  await page.getByTestId("job-done").waitFor({ timeout: 600_000 });

  say("writing the commentary and where to act…");
  const commentary = await written(page.request, companyId, "commentary");
  const actions = await written(page.request, companyId, "board_actions");
  const board = await json<{
    company: Record<string, unknown>;
    periods: string[];
    values: { inputs: { kind: string }[] }[];
    dashboard: { spec: unknown; dataThrough: string | null } | null;
    latestPeriod: string | null;
  }>(page.request, `/api/companies/${companyId}/dashboard`);
  if (board.dashboard === null) throw new Error("the run left no dashboard");

  // What the page needs and nothing that names this run: no ids, no files, no account.
  const company = { ...board.company };
  delete company["id"];
  delete company["name"];
  const kept = (payload: Record<string, unknown>) => {
    const pack = payload["pack"] as Record<string, unknown>;
    return {
      output: payload["output"],
      pack: {
        facts: pack["facts"],
        dimensions: pack["dimensions"],
        periods: pack["periods"],
      },
      allowlist: payload["allowlist"],
    };
  };
  const sample = {
    recordedOn: new Date().toISOString().slice(0, 10),
    name: NAME,
    trade: TRADE,
    company,
    periods: board.periods,
    // A file id from this local run means nothing anywhere else, and lineage never shows one.
    values: board.values.map((v) => ({
      ...v,
      inputs: v.inputs.map((i) => (i.kind === "source" ? { ...i, fileId: "sample" } : i)),
    })),
    spec: board.dashboard.spec,
    dataThrough: board.dashboard.dataThrough,
    commentary: { period: PERIOD, ...kept(commentary) },
    boardActions: { period: PERIOD, ...kept(actions) },
  };
  await writeFile(OUT, `${JSON.stringify(sample)}\n`);

  const spent = await pool.query<{ type: string; credits: string; ai: string }>(
    `select j.type, coalesce(j.captured_credits, 0)::text as credits,
            coalesce(sum(c.usd_cost_micro), 0)::text as ai
       from jobs j left join ai_calls c on c.job_id = j.id
      where j.company_id = $1 group by j.id order by j.created_at`,
    [companyId],
  );
  say("");
  say(`=== recorded to ${path.relative(process.cwd(), OUT)} ===`);
  for (const r of spent.rows)
    say(`${r.type.padEnd(16)} ${r.credits.padStart(6)} credits   AI ${r.ai} micro-USD`);
} finally {
  await browser.close();
  await pool.end();
}
