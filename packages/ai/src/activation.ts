/**
 * Prompt activation gate (SPEC §14): a prompt version runs on a route only after its eval results
 * are recorded for that stage, tier and model and meet `ai.eval_thresholds`. Activation writes a new
 * `tier_routing` version (routing is versioned, never edited in place) and an audit entry.
 */

import { appendAudit } from "@magicmis/db/audit";
import { readConfig } from "@magicmis/db/config";
import { withTransaction } from "@magicmis/db/tx";
import type { Pool } from "pg";
import { z } from "zod";

import type { Stage, Tier } from "./registry";

export class ActivationError extends Error {
  constructor(
    readonly code: "no_route" | "no_eval" | "below_threshold" | "no_threshold",
    message: string,
  ) {
    super(message);
    this.name = "ActivationError";
  }
}

export interface EvalRecord {
  readonly stage: Stage;
  readonly promptName: string;
  readonly promptVersion: number;
  readonly tier: Tier;
  readonly modelId: string;
  readonly mode: "replay" | "live";
  readonly items: number;
  readonly correct: number;
  readonly costMicroUsd: bigint;
  readonly p50LatencyMs: number | null;
  readonly report: Record<string, unknown>;
}

/** accuracy = correct / items to four decimals, rounded down (never flatters a prompt). */
export function accuracyString(correct: number, items: number): string {
  if (items <= 0 || correct < 0 || correct > items)
    throw new RangeError("bad eval counts");
  const bp = (BigInt(correct) * 10_000n) / BigInt(items);
  const s = bp.toString().padStart(5, "0");
  return `${s.slice(0, -4)}.${s.slice(-4)}`;
}

export async function recordEvalRun(pool: Pool, run: EvalRecord): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `insert into public.ai_eval_runs
       (stage, prompt_name, prompt_version, tier, model_id, mode, items, correct, accuracy, cost_micro_usd, p50_latency_ms, report)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [
      run.stage,
      run.promptName,
      run.promptVersion,
      run.tier,
      run.modelId,
      run.mode,
      run.items,
      run.correct,
      accuracyString(run.correct, run.items),
      run.costMicroUsd.toString(),
      run.p50LatencyMs,
      run.report,
    ],
  );
  const id = r.rows[0]?.id;
  if (id === undefined) throw new Error("eval run insert returned no id");
  return id;
}

const scaled = (s: string): bigint => {
  const [whole = "0", frac = ""] = s.split(".");
  return BigInt(whole) * 10_000n + BigInt((frac + "0000").slice(0, 4));
};

/**
 * Only live runs count: a replay proves the harness, not the model's behaviour.
 */
export async function activatePromptVersion(
  pool: Pool,
  input: {
    stage: Stage;
    tier: Tier;
    promptVersion: number;
    actorAdminId: string | null;
  },
): Promise<{ routingVersion: number }> {
  const thresholds = await readConfig(
    pool,
    "ai.eval_thresholds",
    z.record(z.string(), z.string().regex(/^\d+(\.\d+)?$/u)),
  );
  const threshold = thresholds[input.stage];
  if (threshold === undefined) {
    throw new ActivationError(
      "no_threshold",
      `no eval threshold configured for ${input.stage}`,
    );
  }

  return withTransaction(pool, async (tx) => {
    const route = await tx.query<{
      model_id: string;
      effort: string | null;
      max_tokens: number;
      fallback_chain: string[];
      version: number;
    }>(
      `select model_id, effort, max_tokens, fallback_chain, version from public.tier_routing
       where tier = $1 and stage = $2 order by version desc limit 1 for update`,
      [input.tier, input.stage],
    );
    const current = route.rows[0];
    if (current === undefined) {
      throw new ActivationError(
        "no_route",
        `no routing for ${input.tier}/${input.stage}`,
      );
    }
    const best = await tx.query<{ accuracy: string; id: string }>(
      `select accuracy::text as accuracy, id from public.ai_eval_runs
       where stage = $1 and tier = $2 and prompt_version = $3 and model_id = $4 and mode = 'live'
       order by created_at desc limit 1`,
      [input.stage, input.tier, input.promptVersion, current.model_id],
    );
    const run = best.rows[0];
    if (run === undefined) {
      throw new ActivationError(
        "no_eval",
        `no live eval recorded for ${input.stage} v${input.promptVersion.toString()} on ${current.model_id}`,
      );
    }
    if (scaled(run.accuracy) < scaled(threshold)) {
      throw new ActivationError(
        "below_threshold",
        `eval accuracy ${run.accuracy} is below the threshold ${threshold}`,
      );
    }
    const version = current.version + 1;
    await tx.query(
      `insert into public.tier_routing (tier, stage, model_id, effort, max_tokens, fallback_chain, prompt_version, version)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        input.tier,
        input.stage,
        current.model_id,
        current.effort,
        current.max_tokens,
        current.fallback_chain,
        input.promptVersion,
        version,
      ],
    );
    await appendAudit(tx, {
      actorType: input.actorAdminId === null ? "system" : "admin",
      actorId: input.actorAdminId,
      action: "ai.prompt_activated",
      targetType: "ai_eval_run",
      targetId: run.id,
      metadata: {
        stage: input.stage,
        tier: input.tier,
        prompt_version: input.promptVersion,
        routing_version: version,
        accuracy: run.accuracy,
      },
    });
    return { routingVersion: version };
  });
}
