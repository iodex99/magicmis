/**
 * Go-live: evaluate and switch on every AI route in one database (R-28, ADR 0069).
 *
 *   DATABASE_URL=<that database> pnpm --filter @magicmis/ai go-live --dryRun
 *   AI_LIVE=1 ANTHROPIC_API_KEY=… DATABASE_URL=<that database> pnpm --filter @magicmis/ai go-live
 *
 * Activation is per database (SPEC §14): `activatePromptVersion` accepts a prompt only on a live
 * eval recorded in *that* database, on the model *that* database routes to. The evals run on the
 * local stack switched it on here; production starts with every route off and every AI stage
 * refusing. This is the one command that turns it on there. It decides nothing itself: for each
 * stage with an eval and each tier it runs the newest prompt version live, unless it is already
 * active, and hands the result to the same gate the admin console's Activate button uses — which
 * refuses anything under its threshold or over too few items.
 *
 * Spends real money on synthetic data only: about US$22 for every route, once. `--maxCents`
 * caps each run (default 800). Recordings go to the ignored reports folder, never over the
 * committed evidence in evals/recordings/. `chat_deep` has no eval yet (R-44) and is reported.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import pg from "pg";

import { ActivationError, activatePromptVersion } from "../src/activation";
import { STAGES, type Tier } from "../src/registry";
import { anthropicTransport } from "../src/transport";
import { runEval, STAGE_EVALS, type EvaluableStage } from "./harness";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TIERS: readonly Tier[] = ["efficient", "professional", "expert"];

/** The newest prompt a stage has on disk: the highest `vN.md` in prompts/<stage>/. */
async function newestPrompt(stage: string): Promise<number> {
  const files = await readdir(path.join(HERE, "..", "prompts", stage));
  const versions = files
    .map((f) => /^v(\d+)\.md$/u.exec(f)?.[1])
    .filter((v): v is string => v !== undefined)
    .map((v) => Number.parseInt(v, 10));
  if (versions.length === 0) throw new Error(`no prompt versions for ${stage}`);
  return Math.max(...versions);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      dryRun: { type: "boolean", default: false },
      stage: { type: "string" },
      maxCents: { type: "string", default: "800" },
    },
  });
  const url = process.env["DATABASE_URL"];
  if (url === undefined) throw new Error("DATABASE_URL is required");
  const live = process.env["AI_LIVE"] === "1";
  const key = process.env["ANTHROPIC_API_KEY"];
  if (!values.dryRun && (!live || key === undefined))
    throw new Error(
      "a real run needs AI_LIVE=1 and ANTHROPIC_API_KEY; try --dryRun first",
    );
  // Whole US cents, kept in integers: a cap on money never goes through a float (SPEC §4).
  const maxMicroUsd = BigInt(Number.parseInt(values.maxCents, 10)) * 10_000n;

  const pool = new pg.Pool({ connectionString: url });
  const outcome: string[] = [];
  let missing = 0;
  try {
    for (const stage of STAGES) {
      if (values.stage !== undefined && values.stage !== stage) continue;
      if (!(stage in STAGE_EVALS)) {
        outcome.push(
          `${stage.padEnd(20)} all tiers   no eval yet (R-44): not switched on`,
        );
        missing += TIERS.length;
        continue;
      }
      const version = await newestPrompt(stage);
      for (const tier of TIERS) {
        const route = await pool.query<{
          prompt_version: number | null;
          model_id: string;
        }>(
          `select prompt_version, model_id from public.tier_routing
            where stage = $1 and tier = $2 order by version desc limit 1`,
          [stage, tier],
        );
        const current = route.rows[0];
        const label = `${stage.padEnd(20)} ${tier.padEnd(12)}`;
        if (current === undefined) {
          outcome.push(`${label} no route in this database`);
          missing++;
          continue;
        }
        if (current.prompt_version === version) {
          outcome.push(
            `${label} v${version.toString()} already on (${current.model_id})`,
          );
          continue;
        }
        if (values.dryRun) {
          outcome.push(
            `${label} would evaluate v${version.toString()} on ${current.model_id}`,
          );
          missing++;
          continue;
        }
        const report = await runEval({
          pool,
          stage: stage as EvaluableStage,
          tier,
          promptVersion: version,
          mode: "live",
          maxSpendMicroUsd: maxMicroUsd,
          liveTransport: anthropicTransport(key ?? ""),
          recordingPath: path.join(
            HERE,
            "reports",
            "go-live",
            `${stage}-v${version.toString()}-${tier}.json`,
          ),
        });
        try {
          await activatePromptVersion(pool, {
            stage,
            tier,
            promptVersion: version,
            actorAdminId: null,
          });
          outcome.push(
            `${label} v${version.toString()} switched on at ${report.accuracy}`,
          );
        } catch (error) {
          if (!(error instanceof ActivationError)) throw error;
          outcome.push(
            `${label} v${version.toString()} NOT switched on: ${error.message}`,
          );
          missing++;
        }
      }
    }
  } finally {
    await pool.end();
  }
  for (const line of outcome) console.warn(line);
  if (missing > 0) {
    console.warn(`${missing.toString()} route(s) not on.`);
    process.exitCode = 1;
  }
}

await main();
