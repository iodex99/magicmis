/**
 * Eval CLI.
 *
 *   pnpm --filter @magicmis/ai evals --stage sheet_classification --tier efficient --version 1
 *
 * No `--` before the flags: pnpm forwards it as a positional and parseArgs refuses it. The
 * script runs tsx with --conditions=react-server because src/transport.ts imports "server-only",
 * which throws under a plain tsx resolution.
 *
 * Replay (default) needs only DATABASE_URL. Live mode additionally needs AI_LIVE=1 and
 * ANTHROPIC_API_KEY, spends real money on synthetic fixtures, and saves a recording under
 * evals/recordings/ so the run can be replayed. The report is written to evals/reports/.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import pg from "pg";

import type { Tier } from "../src/registry";
import { anthropicTransport } from "../src/transport";
import { runEval, STAGE_EVALS, type EvaluableStage } from "./harness";

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      stage: { type: "string", default: "sheet_classification" },
      tier: { type: "string", default: "efficient" },
      version: { type: "string", default: "1" },
      limit: { type: "string", default: "60" },
      // A hard ceiling for the run, in US cents. Live evals spend real money (R-28).
      maxCents: { type: "string" },
    },
  });
  const stage = values.stage as EvaluableStage;
  if (!(stage in STAGE_EVALS)) throw new Error(`no eval for stage ${stage}`);
  const tier = values.tier as Tier;
  const promptVersion = Number.parseInt(values.version, 10);
  const limit = Number.parseInt(values.limit, 10);
  // Whole US cents, kept in integers: a cap on money never goes through a float (SPEC §4).
  const maxMicroUsd =
    values.maxCents === undefined
      ? undefined
      : BigInt(Number.parseInt(values.maxCents, 10)) * 10_000n;

  const url = process.env["DATABASE_URL"];
  if (url === undefined) throw new Error("DATABASE_URL is required");
  const live = process.env["AI_LIVE"] === "1";
  const key = process.env["ANTHROPIC_API_KEY"];
  if (live && key === undefined) throw new Error("AI_LIVE=1 needs ANTHROPIC_API_KEY");

  const pool = new pg.Pool({ connectionString: url });
  try {
    const name = `${stage}-v${promptVersion.toString()}-${tier}`;
    const report = await runEval({
      pool,
      stage,
      tier,
      promptVersion,
      limit,
      ...(maxMicroUsd === undefined ? {} : { maxSpendMicroUsd: maxMicroUsd }),
      mode: live ? "live" : "replay",
      ...(live && key !== undefined ? { liveTransport: anthropicTransport(key) } : {}),
      recordingPath: path.join(HERE, "recordings", `${name}.json`),
    });
    await mkdir(path.join(HERE, "reports"), { recursive: true });
    const file = path.join(HERE, "reports", `${name}-${report.mode}.json`);
    await writeFile(
      file,
      JSON.stringify(
        report,
        (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v),
        2,
      ),
    );
    if (report.stoppedOnBudget)
      console.warn(`STOPPED ON BUDGET after ${report.items.toString()} items`);
    console.warn(
      `${name} ${report.mode}${report.oracle ? " (oracle)" : ""}: ${report.correct.toString()}/${report.items.toString()} = ${report.accuracy} → ${file}`,
    );
  } finally {
    await pool.end();
  }
}

await main();
