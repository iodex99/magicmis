/**
 * Activate a prompt version for a stage and tier, from the evals already recorded.
 *
 * This does not decide anything: `activatePromptVersion` re-reads `ai.eval_thresholds` and
 * `ai.eval_min_items` and refuses unless a **live** eval exists for this exact stage, tier,
 * prompt version and the model the route currently points at (SPEC §14). Running it is how the
 * decision gets applied; it is not how the decision gets made, and it will say no.
 *
 * Usage, after `evals` has been run live for the same combination:
 *
 *   DATABASE_URL=... pnpm --filter @magicmis/ai activate --stage=board_actions \
 *     --tier=efficient --version=2
 *
 * Without `--stage` it reports what every route currently has activated and stops, which is the
 * safe thing to run first.
 */

import { parseArgs } from "node:util";

import pg from "pg";

import { activatePromptVersion } from "../src/activation";
import { STAGES, type Stage, type Tier } from "../src/registry";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      stage: { type: "string" },
      tier: { type: "string" },
      version: { type: "string" },
    },
  });

  const url = process.env["DATABASE_URL"];
  if (url === undefined) throw new Error("DATABASE_URL is required");
  const pool = new pg.Pool({ connectionString: url });
  try {
    if (values.stage === undefined) {
      const routes = await pool.query<{
        stage: string;
        tier: string;
        prompt_version: number | null;
        model_id: string;
      }>(
        `select distinct on (stage, tier) stage, tier, prompt_version, model_id
           from public.tier_routing order by stage, tier, version desc`,
      );
      for (const r of routes.rows)
        console.warn(
          `${r.stage.padEnd(20)} ${r.tier.padEnd(13)} ${
            r.prompt_version === null
              ? "not activated"
              : `v${r.prompt_version.toString()}`
          }`.padEnd(52) + r.model_id,
        );
      return;
    }

    const stage = values.stage as Stage;
    if (!STAGES.includes(stage)) throw new Error(`unknown stage ${values.stage}`);
    const TIERS: Tier[] = ["efficient", "professional", "expert", "expert_plus"];
    const tier = values.tier as Tier;
    if (!TIERS.includes(tier)) throw new Error(`unknown tier ${values.tier ?? ""}`);
    if (values.version === undefined) throw new Error("--version is required");
    const promptVersion = Number.parseInt(values.version, 10);

    // No admin id: this is the owner's own console-equivalent, and the audit row says so.
    const { routingVersion } = await activatePromptVersion(pool, {
      stage,
      tier,
      promptVersion,
      actorAdminId: null,
    });
    console.warn(
      `${stage} ${tier} now runs prompt v${promptVersion.toString()} (routing version ${routingVersion.toString()})`,
    );
  } finally {
    await pool.end();
  }
}

await main();
