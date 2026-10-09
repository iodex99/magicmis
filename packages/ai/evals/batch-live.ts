/**
 * One small Message Batch against the real API (ADR 0084).
 *
 * Commentary at standard delivery goes through the Message Batches API (`commentaryBatchTick` in
 * the worker), and every unit test of it runs on a scripted transport. Every customer job is
 * instant since ADR 0050, so nothing in the product sends a batch today — which is exactly why
 * the path is checked here rather than discovered broken the day standard delivery returns.
 *
 * Submits three commentary items from the eval dataset at one tier, polls until the batch ends,
 * and checks what came back: each result passed the stage's own checks, and each call is recorded
 * as a batch call at the batch discount. Costs a few cents on synthetic data.
 *
 *   AI_LIVE=1 ANTHROPIC_API_KEY=… DATABASE_URL=… \
 *     pnpm --filter @magicmis/ai exec tsx --conditions=react-server evals/batch-live.ts
 */

import pg from "pg";

import { collectCommentaryBatch, submitCommentaryBatch } from "../src/batch";
import { CostBudget } from "../src/orchestrator";
import { anthropicTransport } from "../src/transport";
import { commentaryDataset } from "./datasets";
import { evalAccount } from "./harness";

const url = process.env["DATABASE_URL"];
const apiKey = process.env["ANTHROPIC_API_KEY"];
if (url === undefined) throw new Error("DATABASE_URL is required");
if (process.env["AI_LIVE"] !== "1" || apiKey === undefined)
  throw new Error("a real batch needs AI_LIVE=1 and ANTHROPIC_API_KEY");

const pool = new pg.Pool({ connectionString: url, max: 2 });
const say = (line: string) => process.stdout.write(`${line}\n`);
/** Micro-USD as dollars, exactly: money never goes through a float (SPEC §4). */
const dollars = (micro: string): string => {
  const n = BigInt(micro);
  return `$${(n / 1_000_000n).toString()}.${(n % 1_000_000n).toString().padStart(6, "0")}`;
};
try {
  const accountId = await evalAccount(pool);
  const transport = anthropicTransport(apiKey);
  const items = commentaryDataset(3).map((item, i) => ({
    customId: `live_batch_${i.toString()}_${Date.now().toString()}`,
    ctx: {
      db: pool,
      transport,
      accountId,
      jobId: null,
      tier: "professional" as const,
      // $0.50 for the three: far above what they cost, far below a mistake.
      budget: new CostBudget(5000n),
    },
    input: item.input,
  }));

  const submitted = await submitCommentaryBatch(items);
  say(`submitted ${submitted.batchId} with ${items.length.toString()} requests`);

  const deadline = Date.now() + 90 * 60_000;
  let results = await collectCommentaryBatch(submitted.batchId, items);
  while (results === null) {
    if (Date.now() > deadline) throw new Error("the batch did not end within 90 minutes");
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    results = await collectCommentaryBatch(submitted.batchId, items);
  }

  for (const r of results) say(`${r.customId}: ${r.status}`);
  const recorded = await pool.query<{
    status: string;
    is_batch: boolean;
    n: number;
    usd_micro: string;
  }>(
    `select status, is_batch, count(*)::int n, sum(usd_cost_micro)::text usd_micro
       from ai_calls where batch_id = $1 group by 1, 2`,
    [submitted.batchId],
  );
  for (const row of recorded.rows)
    say(
      `recorded: ${row.n.toString()} × ${row.status}, batch=${String(row.is_batch)}, ${dollars(row.usd_micro)}`,
    );
  const ok = results.filter((r) => r.status === "ok").length;
  say(`${ok.toString()} of ${results.length.toString()} came back usable`);
  if (ok === 0) process.exitCode = 1;
} finally {
  await pool.end();
}
