/**
 * Job cost estimation (SPEC §12). The browser sends size descriptors only — counts, no content.
 * Per stage, tokens are estimated from characters (config `ai.estimator`: chars per token and a
 * tokenizer inflation factor, since newer models tokenise ~30% heavier) and priced at the routed
 * model; the p90 multiplier gives a conservative figure. Where `estimator_calibration` holds a
 * p90 for the action, tier and size bucket, the larger of the two is used.
 *
 * The result decides exact price versus quote: p90 cost ≤ cap → exact price; otherwise a quote.
 */

import {
  divideRounded,
  microUsd,
  multiplyByDecimalString,
  type MicroUsd,
} from "@magicmis/core/money";
import { readConfig } from "@magicmis/db/config";
import type { Queryable } from "@magicmis/db/tx";
import { z } from "zod";

import { costMicroUsd, costPaise } from "./cost";
import { loadModel, loadRoute, RoutingError, type Stage, type Tier } from "./registry";

const decimal = z.string().regex(/^\d+(\.\d+)?$/u);

export const estimatorConfigSchema = z.object({
  chars_per_token: decimal,
  tokenizer_inflation: decimal,
  output_tokens_ratio: decimal,
  p90_multiplier: decimal,
  calibration_window_days: z.number().int().positive(),
});

/** SPEC §12 size descriptors: counts only. */
export const sizeDescriptorsSchema = z.object({
  files: z.number().int().nonnegative().max(1000),
  sheets: z.number().int().nonnegative().max(10_000),
  columns: z.number().int().nonnegative().max(1_000_000),
  rows: z.number().int().nonnegative(),
  /** Distinct values in candidate ledger or party columns, after the payload cap. */
  distinctLedgerValues: z.number().int().nonnegative().max(1_000_000),
  referenceMisSheets: z.number().int().nonnegative().max(1000).default(0),
});
export type SizeDescriptors = z.infer<typeof sizeDescriptorsSchema>;

/**
 * Characters each stage sends for a given size. Fixed overheads are the prompt files and schemas;
 * per-item sizes follow the payload caps (15 sample rows, ~24 chars per cell).
 */
const STAGE_CHARS: Partial<Record<Stage, (s: SizeDescriptors) => number>> = {
  sheet_classification: (s) =>
    3_000 + s.sheets * (400 + Math.min(s.columns, 80) * 40 * 16),
  column_mapping: (s) =>
    2_000 + s.sheets * 300 + Math.min(s.columns, s.sheets * 80) * 24 * 16,
  ledger_mapping: (s) => 4_000 + 8_000 + Math.min(s.distinctLedgerValues, 2000) * 90,
  reference_layout: (s) =>
    s.referenceMisSheets === 0 ? 0 : 4_000 + s.referenceMisSheets * 6_000,
};

/** Stages each job type runs (SPEC §15, §23). Stages with no route or not activated are skipped. */
export const JOB_STAGES: Readonly<Record<string, readonly Stage[]>> = {
  data_diagnostic: ["sheet_classification", "column_mapping"],
  company_setup: ["sheet_classification", "column_mapping", "ledger_mapping"],
  reference_mis_recreate: [
    "sheet_classification",
    "column_mapping",
    "ledger_mapping",
    "reference_layout",
  ],
  refresh_with_restructure: ["sheet_classification", "column_mapping", "ledger_mapping"],
  // A refresh on unchanged structure makes zero AI calls (SPEC §35).
  monthly_refresh: [],
  dashboard_addon: [],
  dashboard_refresh: [],
  commentary: ["commentary"],
};

export function sizeBucket(s: SizeDescriptors): string {
  const units = s.sheets * 10 + s.distinctLedgerValues;
  if (units <= 200) return "s";
  if (units <= 1_000) return "m";
  if (units <= 5_000) return "l";
  return "xl";
}

export interface StageEstimate {
  readonly stage: Stage;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMicroUsd: MicroUsd;
}

export interface JobEstimate {
  readonly stages: readonly StageEstimate[];
  readonly p50MicroUsd: MicroUsd;
  readonly p90MicroUsd: MicroUsd;
  readonly p90Paise: bigint;
  readonly bucket: string;
  readonly calibrated: boolean;
}

const tokensFor = (chars: number, cfg: z.infer<typeof estimatorConfigSchema>): number => {
  // ceil(chars × inflation / chars_per_token), exactly.
  const inflated = multiplyByDecimalString(
    BigInt(chars),
    cfg.tokenizer_inflation,
    "ceil",
  );
  const scaled = multiplyByDecimalString(1_000_000n, cfg.chars_per_token, "floor");
  return tokenCount(divideRounded(inflated * 1_000_000n, scaled, "ceil"));
};

/** Token counts are not money; they are integers well inside the safe range. */
function tokenCount(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError("token estimate out of range");
  return Number.parseInt(value.toString(), 10);
}

export async function estimateJob(
  db: Queryable,
  input: { actionKey: string; tier: Tier; size: SizeDescriptors },
): Promise<JobEstimate> {
  const size = sizeDescriptorsSchema.parse(input.size);
  const cfg = await readConfig(db, "ai.estimator", estimatorConfigSchema);
  const fx = await readConfig(
    db,
    "ai.fx",
    z.object({ inr_per_usd: z.string(), buffer_percent: z.string() }),
  );

  const stages: StageEstimate[] = [];
  for (const stage of JOB_STAGES[input.actionKey] ?? []) {
    const chars = STAGE_CHARS[stage]?.(size) ?? 0;
    if (chars === 0) continue;
    let route;
    try {
      route = await loadRoute(db, input.tier, stage);
    } catch (error) {
      // Not-yet-activated stages still cost money once activated; estimate them at the routed model.
      if (!(error instanceof RoutingError) || error.code !== "stage_not_activated")
        throw error;
      const r = await db.query(
        `select model_id, max_tokens from public.tier_routing where tier = $1 and stage = $2 order by version desc limit 1`,
        [input.tier, stage],
      );
      route = r.rows[0] as { model_id: string; max_tokens: number };
    }
    const model = await loadModel(db, route.model_id);
    const inputTokens = tokensFor(chars, cfg);
    const out = tokenCount(
      multiplyByDecimalString(BigInt(inputTokens), cfg.output_tokens_ratio, "ceil"),
    );
    const outputTokens = Math.min(route.max_tokens, out);
    stages.push({
      stage,
      inputTokens,
      outputTokens,
      costMicroUsd: costMicroUsd(
        { input_tokens: inputTokens, output_tokens: outputTokens },
        model,
      ),
    });
  }

  const p50 = stages.reduce((s, e) => s + e.costMicroUsd, 0n);
  let p90 = multiplyByDecimalString(p50, cfg.p90_multiplier, "ceil");
  const bucket = sizeBucket(size);
  const cal = await db.query<{ p90: string }>(
    `select p90_cost_micro_usd::text as p90 from public.estimator_calibration
     where action_key = $1 and tier = $2 and size_bucket = $3 and sample_count > 0`,
    [input.actionKey, input.tier, bucket],
  );
  const calibratedP90 = cal.rows[0] === undefined ? null : BigInt(cal.rows[0].p90);
  if (calibratedP90 !== null && calibratedP90 > p90) p90 = calibratedP90;

  return {
    stages,
    p50MicroUsd: microUsd(p50),
    p90MicroUsd: microUsd(p90),
    p90Paise: costPaise(microUsd(p90), fx).paise,
    bucket,
    calibrated: calibratedP90 !== null,
  };
}

/** SPEC §12 step 3/4: exact price when p90 fits under the cap, otherwise a quote. */
export function priceDecision(
  estimate: JobEstimate,
  capPaise: bigint,
): "exact" | "quote" {
  return estimate.p90Paise <= capPaise ? "exact" : "quote";
}

/**
 * Nightly calibration (SPEC §12): p50 and p90 AI cost per action, tier and size bucket from
 * completed jobs' ai_calls. Jobs record their bucket in stage_checkpoints.size_bucket.
 */
export async function recalibrateEstimator(db: Queryable, since: Date): Promise<number> {
  const r = await db.query(
    `with job_costs as (
       select j.type as action_key, j.tier, coalesce(j.stage_checkpoints->>'size_bucket', 'm') as size_bucket,
              sum(c.usd_cost_micro) as cost
       from public.jobs j join public.ai_calls c on c.job_id = j.id
       where j.completed_at >= $1
       group by j.id, j.type, j.tier, j.stage_checkpoints->>'size_bucket'
     ), pct as (
       select action_key, tier, size_bucket,
              ceil(percentile_cont(0.5) within group (order by cost))::bigint as p50,
              ceil(percentile_cont(0.9) within group (order by cost))::bigint as p90,
              count(*)::int as n
       from job_costs group by action_key, tier, size_bucket
     )
     insert into public.estimator_calibration
       (action_key, tier, size_bucket, p50_cost_micro_usd, p90_cost_micro_usd, sample_count, updated_at)
     select action_key, tier, size_bucket, p50, greatest(p90, p50), n, now() from pct
     on conflict (action_key, tier, size_bucket) do update set
       p50_cost_micro_usd = excluded.p50_cost_micro_usd,
       p90_cost_micro_usd = excluded.p90_cost_micro_usd,
       sample_count = excluded.sample_count,
       updated_at = excluded.updated_at`,
    [since],
  );
  return r.rowCount ?? 0;
}
