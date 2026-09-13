/**
 * Jobs and the AI cost cap (SPEC §12, §23).
 *
 * `jobAiContext` derives a job's cap from its price and the action's `max_ai_cost_ratio`, or from
 * the accepted quote, and seeds the budget with what the job has already spent. `runJobAiStage`
 * runs a stage and, when the runtime cap is hit, pauses the job: state `needs_quote`, reservation
 * released, the cost so far absorbed as an `estimation_miss` margin event, and a quote offered to
 * continue from the checkpoint.
 */

import { readConfig } from "@magicmis/db/config";
import { withTransaction } from "@magicmis/db/tx";
import {
  aiCostCapPaise,
  createQuote,
  priceBookEntry,
  quoteCreditsFor,
  releaseReservation,
  type ActionKey,
} from "@magicmis/wallet";
import type { Pool } from "pg";
import { z } from "zod";

import { costPaise } from "./cost";
import { CostBudget, RuntimeCapExceeded, type AiContext } from "./orchestrator";
import type { Tier } from "./registry";
import type { AiTransport } from "./transport";

const fxSchema = z.object({ inr_per_usd: z.string(), buffer_percent: z.string() });

interface JobRow {
  id: string;
  account_id: string;
  type: ActionKey;
  tier: Tier;
  state: string;
  price_credits: string | null;
  quote_id: string | null;
  reservation_id: string | null;
}

async function loadJob(pool: Pool, jobId: string): Promise<JobRow> {
  const r = await pool.query<JobRow>(
    `select id, account_id, type, tier, state, price_credits::text as price_credits, quote_id, reservation_id
     from public.jobs where id = $1`,
    [jobId],
  );
  const job = r.rows[0];
  if (job === undefined) throw new Error(`job ${jobId} not found`);
  return job;
}

export async function jobAiContext(
  pool: Pool,
  transport: AiTransport,
  jobId: string,
): Promise<AiContext> {
  const job = await loadJob(pool, jobId);
  const entry = await priceBookEntry(pool, job.type);

  let capCredits: bigint | null =
    job.price_credits === null ? null : BigInt(job.price_credits);
  if (job.quote_id !== null) {
    const q = await pool.query<{ credits: string }>(
      `select credits::text as credits from public.quotes where id = $1 and status = 'accepted'`,
      [job.quote_id],
    );
    const accepted = q.rows[0];
    if (accepted !== undefined) capCredits = BigInt(accepted.credits);
  }
  if (capCredits === null) throw new Error(`job ${jobId} has no price or accepted quote`);

  const spent = await pool.query<{ total: string }>(
    `select coalesce(sum(usd_cost_micro), 0)::text as total from public.ai_calls where job_id = $1`,
    [jobId],
  );
  return {
    db: pool,
    transport,
    accountId: job.account_id,
    jobId,
    tier: job.tier,
    budget: new CostBudget(
      aiCostCapPaise(capCredits, entry.max_ai_cost_ratio),
      BigInt(spent.rows[0]?.total ?? "0"),
    ),
  };
}

export type JobStageOutcome<T> =
  | { readonly status: "done"; readonly value: T }
  | {
      readonly status: "paused";
      readonly quoteId: string;
      readonly quoteCredits: bigint;
    };

/** Totals the job's recorded AI cost onto the job row. */
export async function syncJobAiCost(pool: Pool, jobId: string): Promise<void> {
  await pool.query(
    `update public.jobs j set
       actual_ai_cost_micro_usd = c.usd, actual_ai_cost_paise = c.paise
     from (select coalesce(sum(usd_cost_micro), 0) as usd, coalesce(sum(inr_cost_paise), 0) as paise
           from public.ai_calls where job_id = $1) c
     where j.id = $1`,
    [jobId],
  );
}

export async function runJobAiStage<T>(
  ctx: AiContext,
  run: (ctx: AiContext) => Promise<T>,
  now: Date = new Date(),
): Promise<JobStageOutcome<T>> {
  if (ctx.jobId === null) throw new Error("runJobAiStage needs a job");
  try {
    const value = await run(ctx);
    await syncJobAiCost(ctx.db, ctx.jobId);
    return { status: "done", value };
  } catch (error) {
    await syncJobAiCost(ctx.db, ctx.jobId);
    if (!(error instanceof RuntimeCapExceeded)) throw error;
    return pauseForRuntimeCap(ctx.db, ctx.jobId, error, now);
  }
}

async function pauseForRuntimeCap(
  pool: Pool,
  jobId: string,
  error: RuntimeCapExceeded,
  now: Date,
): Promise<JobStageOutcome<never>> {
  const job = await loadJob(pool, jobId);
  const entry = await priceBookEntry(pool, job.type, now);
  const fx = await readConfig(pool, "ai.fx", fxSchema);
  const endings = await readConfig(
    pool,
    "pricing.quote_endings",
    z.array(z.number().int()),
  );

  if (job.reservation_id !== null) {
    await releaseReservation(pool, {
      reservationId: job.reservation_id,
      idempotencyKey: `runtime-cap:${jobId}:${job.reservation_id}`,
      now,
    });
  }

  return withTransaction(pool, async (tx) => {
    // The whole projected cost is quoted: work already done is absorbed, and continuing from the
    // checkpoint must again fit under max_ai_cost_ratio.
    const credits = quoteCreditsFor(
      error.projectedPaise,
      entry.max_ai_cost_ratio,
      endings,
    );
    const { quoteId } = await createQuote(tx, {
      accountId: job.account_id,
      jobId,
      reason: "runtime_cap",
      credits,
      now,
    });
    await tx.query(
      `insert into public.margin_events (kind, account_id, job_id, stage, cost_micro_usd, cost_paise, detail, created_at)
       values ('estimation_miss', $1, $2, $3, $4, $5, $6, $7)`,
      [
        job.account_id,
        jobId,
        error.stage,
        error.spentMicroUsd.toString(),
        costPaise(error.spentMicroUsd, fx).paise.toString(),
        {
          projected_paise: error.projectedPaise.toString(),
          cap_paise: error.capPaise.toString(),
          quote_id: quoteId,
        },
        now,
      ],
    );
    await tx.query(
      `update public.jobs set state = 'needs_quote', reservation_id = null, quote_id = $2 where id = $1`,
      [jobId, quoteId],
    );
    return { status: "paused", quoteId, quoteCredits: credits };
  });
}
