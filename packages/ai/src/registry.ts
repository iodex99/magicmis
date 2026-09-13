/**
 * Model registry and tier routing (SPEC §14), read from the database — never hardcoded.
 * The latest version of each row is in effect.
 */

import type { Queryable } from "@magicmis/db/tx";
import { z } from "zod";

export const STAGES = [
  "sheet_classification",
  "column_mapping",
  "ledger_mapping",
  "reference_layout",
  "commentary",
  "chat_quick",
  "chat_deep",
  "chat_edit",
  "thread_summary",
] as const;
export type Stage = (typeof STAGES)[number];
export type Tier = "efficient" | "professional" | "expert" | "expert_plus";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

const decimal = z.string().regex(/^\d+(\.\d+)?$/u);

export const modelRowSchema = z.object({
  model_id: z.string().min(1),
  input_price_per_mtok_micro_usd: z.coerce.bigint(),
  output_price_per_mtok_micro_usd: z.coerce.bigint(),
  cache_read_multiplier: decimal,
  cache_write_multiplier: decimal,
  cache_write_1h_multiplier: decimal,
  batch_discount: decimal,
  available: z.boolean(),
  version: z.number().int(),
  source_url: z.string(),
  verified_at: z.date(),
});
export type ModelRow = z.infer<typeof modelRowSchema>;

export const routeRowSchema = z.object({
  tier: z.enum(["efficient", "professional", "expert", "expert_plus"]),
  stage: z.enum(STAGES),
  model_id: z.string().min(1),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).nullable(),
  max_tokens: z.number().int().positive(),
  fallback_chain: z.array(z.string()),
  prompt_version: z.number().int().positive().nullable(),
  version: z.number().int(),
});
export type RouteRow = z.infer<typeof routeRowSchema>;

export class RoutingError extends Error {
  constructor(
    readonly code:
      "no_route" | "stage_not_activated" | "model_unknown" | "model_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "RoutingError";
  }
}

export async function loadModel(db: Queryable, modelId: string): Promise<ModelRow> {
  const r = await db.query(
    `select model_id, input_price_per_mtok_micro_usd::text as input_price_per_mtok_micro_usd,
            output_price_per_mtok_micro_usd::text as output_price_per_mtok_micro_usd,
            cache_read_multiplier::text as cache_read_multiplier,
            cache_write_multiplier::text as cache_write_multiplier,
            cache_write_1h_multiplier::text as cache_write_1h_multiplier,
            batch_discount::text as batch_discount, available, version, source_url, verified_at
     from public.model_registry where model_id = $1 order by version desc limit 1`,
    [modelId],
  );
  const row = r.rows[0] as unknown;
  if (row === undefined)
    throw new RoutingError("model_unknown", `model ${modelId} is not in the registry`);
  return modelRowSchema.parse(row);
}

export async function loadRoute(
  db: Queryable,
  tier: Tier,
  stage: Stage,
  /** Evals only: run a candidate prompt version on this route before it is activated. */
  evalPromptVersion?: number,
): Promise<RouteRow> {
  const r = await db.query(
    `select tier, stage, model_id, effort, max_tokens, fallback_chain, prompt_version, version
     from public.tier_routing where tier = $1 and stage = $2 order by version desc limit 1`,
    [tier, stage],
  );
  const row = r.rows[0] as unknown;
  if (row === undefined)
    throw new RoutingError("no_route", `no routing for ${tier}/${stage}`);
  const route = routeRowSchema.parse(row);
  if (evalPromptVersion !== undefined)
    return { ...route, prompt_version: evalPromptVersion };
  if (route.prompt_version === null) {
    throw new RoutingError(
      "stage_not_activated",
      `${stage} has no prompt version activated for ${tier}`,
    );
  }
  return route;
}

/** Haiku 4.5 does not accept `output_config.effort` (verified 2026-09-13, ADR 0019). */
export const modelSupportsEffort = (modelId: string): boolean =>
  !modelId.startsWith("claude-haiku-4-5");
