/**
 * Job creation, pricing, reservation and stage progress (SPEC §12, §23).
 *
 * The browser drives the pipeline (raw data never leaves it) but cannot choose prices, skip
 * stages backwards, or touch another account's job: every call re-reads the job under a row lock
 * and checks the transition. Prices come only from the price book; estimates only from size
 * descriptors (counts).
 */

import { estimateJob, type SizeDescriptors } from "@magicmis/ai/estimator";
import { readConfig } from "@magicmis/db/config";
import { withTransaction } from "@magicmis/db/tx";
import {
  createQuote,
  decideQuote,
  heartbeatReservation,
  priceBookEntry,
  priceFor,
  quoteCreditsFor,
  reserveCredits,
  type ActionKey,
  type DeliveryMode,
} from "@magicmis/wallet";
import type { Pool } from "pg";
import { z } from "zod";

import { compareFingerprints, type DriftResult } from "./drift";
import { queueNotification } from "./notify";
import { lockJob, transition, JobStateError, type JobState } from "./states";

export type JobType =
  | "data_diagnostic"
  | "company_setup"
  | "reference_mis_recreate"
  | "monthly_refresh"
  | "refresh_with_restructure"
  | "dashboard_addon"
  | "dashboard_refresh"
  | "commentary";

export type PricedTier = "efficient" | "professional" | "expert";

/**
 * The price of a job type. Recreating a reference MIS is "added to setup" (SPEC §12 price book):
 * a setup that includes one costs the setup price plus the add-on, with both AI cost caps.
 */
export async function jobPrice(
  db: Parameters<typeof priceFor>[0],
  input: { type: JobType; tier: PricedTier; delivery: DeliveryMode; at: Date },
): Promise<{ credits: bigint; aiCostCapPaise: bigint }> {
  const one = (actionKey: ActionKey) =>
    priceFor(db, {
      actionKey,
      tier: input.tier,
      delivery: input.delivery,
      at: input.at,
    });
  if (input.type !== "reference_mis_recreate") return one(input.type);
  const [setup, addon] = await Promise.all([
    one("company_setup"),
    one("reference_mis_recreate"),
  ]);
  return {
    credits: setup.credits + addon.credits,
    aiCostCapPaise: setup.aiCostCapPaise + addon.aiCostCapPaise,
  };
}

export class JobError extends Error {
  constructor(
    readonly code:
      | "company_not_found"
      | "company_not_active"
      | "no_blueprint"
      | "insufficient_credits"
      | "quote_not_accepted"
      | "not_found",
    message: string,
    readonly detail: Record<string, string> = {},
  ) {
    super(message);
    this.name = "JobError";
  }
}

export interface CreatedJob {
  readonly jobId: string;
  readonly state: JobState;
  readonly type: JobType;
  readonly priceCredits: bigint;
  readonly quote: {
    readonly quoteId: string;
    readonly credits: bigint;
    readonly expiresAt: Date;
  } | null;
  readonly drift: DriftResult | null;
  readonly duplicate: boolean;
}

interface CompanyRow {
  id: string;
  lifecycle_state: string;
  first_setup_at: Date | null;
  deleted_at: Date | null;
}

async function companyFor(
  pool: Pool,
  accountId: string,
  companyId: string,
): Promise<CompanyRow> {
  const r = await pool.query<CompanyRow>(
    `select id, lifecycle_state, first_setup_at, deleted_at from public.companies where id = $1 and account_id = $2`,
    [companyId, accountId],
  );
  const c = r.rows[0];
  if (c === undefined || c.deleted_at !== null)
    throw new JobError("company_not_found", "Company not found.");
  // SPEC §28: grace allows viewing and buying credits only; archived allows only restore.
  if (c.lifecycle_state !== "active") {
    throw new JobError(
      "company_not_active",
      "This company is not active. Pay the memory fee or restore it to run jobs.",
      {
        lifecycle_state: c.lifecycle_state,
      },
    );
  }
  return c;
}

export async function createJob(
  pool: Pool,
  input: {
    accountId: string;
    companyId: string;
    type: JobType;
    tier: PricedTier;
    delivery: DeliveryMode;
    idempotencyKey: string;
    size: SizeDescriptors;
    sourceFingerprints?: Readonly<Record<string, string>>;
    now?: Date;
  },
): Promise<CreatedJob> {
  const now = input.now ?? new Date();
  const company = await companyFor(pool, input.accountId, input.companyId);

  const existing = await pool.query<{
    id: string;
    state: JobState;
    type: JobType;
    price_credits: string | null;
    quote_id: string | null;
    stage_checkpoints: Record<string, unknown>;
  }>(
    `select id, state, type, price_credits::text as price_credits, quote_id, stage_checkpoints
     from public.jobs where account_id = $1 and idempotency_key = $2`,
    [input.accountId, input.idempotencyKey],
  );
  const dup = existing.rows[0];
  if (dup !== undefined) {
    const q =
      dup.quote_id === null
        ? null
        : (
            await pool.query<{ credits: string; expires_at: Date }>(
              `select credits::text as credits, expires_at from public.quotes where id = $1`,
              [dup.quote_id],
            )
          ).rows[0];
    return {
      jobId: dup.id,
      state: dup.state,
      type: dup.type,
      priceCredits: BigInt(dup.price_credits ?? "0"),
      quote:
        q === undefined || q === null || dup.quote_id === null
          ? null
          : {
              quoteId: dup.quote_id,
              credits: BigInt(q.credits),
              expiresAt: q.expires_at,
            },
      drift: (dup.stage_checkpoints["drift"] as DriftResult | undefined) ?? null,
      duplicate: true,
    };
  }

  let type = input.type;
  let drift: DriftResult | null = null;
  if (type === "monthly_refresh" || type === "refresh_with_restructure") {
    if (company.first_setup_at === null)
      throw new JobError("no_blueprint", "Set up this company before refreshing it.");
    const bp = await pool.query<{ source_fingerprints: Record<string, string> }>(
      `select source_fingerprints from public.blueprints where company_id = $1 order by version desc limit 1`,
      [input.companyId],
    );
    const previous = bp.rows[0]?.source_fingerprints ?? {};
    if (input.sourceFingerprints !== undefined) {
      const threshold = await readConfig(pool, "jobs.drift_threshold", z.string());
      drift = compareFingerprints(previous, input.sourceFingerprints, threshold);
      if (drift.beyondThreshold) type = "refresh_with_restructure";
    }
  }

  const price = await jobPrice(pool, {
    type,
    tier: input.tier,
    delivery: input.delivery,
    at: now,
  });
  const estimate = await estimateJob(pool, {
    actionKey: type,
    tier: input.tier,
    size: input.size,
  });
  const overCap = estimate.p90Paise > price.aiCostCapPaise;

  return withTransaction(pool, async (tx) => {
    const inserted = await tx.query<{ id: string }>(
      `insert into public.jobs
         (account_id, company_id, type, tier, delivery_mode, state, price_credits, estimated_ai_cost_micro_usd,
          idempotency_key, stage_checkpoints, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [
        input.accountId,
        input.companyId,
        type,
        input.tier,
        input.delivery,
        overCap ? "needs_quote" : "estimated",
        price.credits.toString(),
        estimate.p90MicroUsd.toString(),
        input.idempotencyKey,
        JSON.stringify({
          size_bucket: estimate.bucket,
          ...(drift === null ? {} : { drift }),
          source_fingerprints: input.sourceFingerprints ?? {},
        }),
        now,
      ],
    );
    const jobId = inserted.rows[0]?.id;
    if (jobId === undefined) throw new Error("job insert returned no id");

    let quote: CreatedJob["quote"] = null;
    if (overCap) {
      const entry = await priceBookEntry(tx, type, now);
      const endings = await readConfig(
        tx,
        "pricing.quote_endings",
        z.array(z.number().int()),
      );
      const credits = quoteCreditsFor(
        estimate.p90Paise,
        entry.max_ai_cost_ratio,
        endings,
      );
      const q = await createQuote(tx, {
        accountId: input.accountId,
        jobId,
        reason: "estimate_over_cap",
        credits,
        now,
      });
      await tx.query(`update public.jobs set quote_id = $2 where id = $1`, [
        jobId,
        q.quoteId,
      ]);
      await queueNotification(tx, {
        accountId: input.accountId,
        type: "job.quote_offered",
        payload: {
          job_id: jobId,
          credits: credits.toString(),
          expires_at: q.expiresAt.toISOString(),
        },
        dedupeKey: `quote:${q.quoteId}`,
      });
      quote = { quoteId: q.quoteId, credits, expiresAt: q.expiresAt };
    }
    return {
      jobId,
      state: overCap ? "needs_quote" : "estimated",
      type,
      priceCredits: price.credits,
      quote,
      drift,
      duplicate: false,
    };
  });
}

/** The credits this job settles against: an accepted quote if there is one, else the price. */
export async function jobChargeBase(pool: Pool, jobId: string): Promise<bigint> {
  const r = await pool.query<{
    price_credits: string | null;
    quote_credits: string | null;
  }>(
    `select j.price_credits::text as price_credits, q.credits::text as quote_credits
     from public.jobs j left join public.quotes q on q.id = j.quote_id and q.status = 'accepted'
     where j.id = $1`,
    [jobId],
  );
  const row = r.rows[0];
  return BigInt(row?.quote_credits ?? row?.price_credits ?? "0");
}

async function reserveFor(
  pool: Pool,
  accountId: string,
  jobId: string,
  delivery: DeliveryMode,
  amount: bigint,
  key: string,
  now: Date,
) {
  const res = await reserveCredits(pool, {
    accountId,
    amount,
    kind: delivery === "standard" ? "batch" : "realtime",
    subject: { jobId },
    idempotencyKey: key,
    now,
  });
  if (!res.ok) {
    throw new JobError(
      "insufficient_credits",
      "Not enough credits for this job. Buy credits and try again.",
      {
        available: res.available.toString(),
        shortfall: res.shortfall.toString(),
      },
    );
  }
  return res.reservationId;
}

/** The user confirmed the exact price: hold the credits and move to `reserved`. */
export async function confirmJob(
  pool: Pool,
  input: { accountId: string; jobId: string; now?: Date },
): Promise<{ reservationId: string }> {
  const now = input.now ?? new Date();
  const job = await withTransaction(pool, (tx) =>
    lockJob(tx, input.jobId, input.accountId),
  );
  if (job.state === "reserved" && job.reservation_id !== null)
    return { reservationId: job.reservation_id };
  if (job.state !== "estimated")
    throw new JobStateError("invalid_transition", `cannot confirm a job in ${job.state}`);
  await companyFor(pool, input.accountId, job.company_id ?? "");
  const reservationId = await reserveFor(
    pool,
    input.accountId,
    job.id,
    job.delivery_mode,
    BigInt(job.price_credits ?? "0"),
    `job:${job.id}:reserve`,
    now,
  );
  await withTransaction(pool, async (tx) => {
    const locked = await lockJob(tx, input.jobId, input.accountId);
    if (locked.state === "reserved") return;
    await transition(tx, locked, "reserved");
    await tx.query(`update public.jobs set reservation_id = $2 where id = $1`, [
      job.id,
      reservationId,
    ]);
  });
  return { reservationId };
}

/**
 * Accept the job's quote (estimate over cap, or a runtime-cap pause) and hold its credits. A
 * paused job resumes from its checkpoint: finished AI stages are reused, never paid again.
 */
export async function acceptJobQuote(
  pool: Pool,
  input: { accountId: string; jobId: string; now?: Date },
): Promise<{ reservationId: string; resumeFrom: JobState | null }> {
  const now = input.now ?? new Date();
  const job = await withTransaction(pool, (tx) =>
    lockJob(tx, input.jobId, input.accountId),
  );
  const resumeFrom =
    (job.stage_checkpoints["last_running_state"] as JobState | undefined) ?? null;
  if (job.state === "reserved" && job.reservation_id !== null)
    return { reservationId: job.reservation_id, resumeFrom };
  if (
    job.quote_id === null ||
    (job.state !== "needs_quote" && job.state !== "quote_accepted")
  ) {
    throw new JobStateError(
      "invalid_transition",
      `job ${job.state} has no quote to accept`,
    );
  }
  if (job.state === "needs_quote") {
    const decided = await decideQuote(pool, {
      quoteId: job.quote_id,
      accountId: input.accountId,
      decision: "accept",
      now,
    });
    if (
      decided.status !== "accepted" &&
      !(decided.status === "already_decided" && decided.current === "accepted")
    ) {
      throw new JobError(
        "quote_not_accepted",
        "This quote has expired or was declined. Request a new estimate.",
        { status: decided.status },
      );
    }
    await withTransaction(pool, async (tx) =>
      transition(tx, await lockJob(tx, job.id, input.accountId), "quote_accepted"),
    );
  }
  const credits = await jobChargeBase(pool, job.id);
  const reservationId = await reserveFor(
    pool,
    input.accountId,
    job.id,
    job.delivery_mode,
    credits,
    `job:${job.id}:reserve:${job.quote_id}`,
    now,
  );
  await withTransaction(pool, async (tx) => {
    const locked = await lockJob(tx, input.jobId, input.accountId);
    if (locked.state === "reserved") return;
    await transition(tx, locked, "reserved");
    await tx.query(`update public.jobs set reservation_id = $2 where id = $1`, [
      job.id,
      reservationId,
    ]);
  });
  return { reservationId, resumeFrom };
}

/** Pipeline progress reported by the browser; only forward moves through SPEC §23's stages. */
export async function advanceJob(
  pool: Pool,
  input: { accountId: string; jobId: string; to: JobState; now?: Date },
): Promise<void> {
  const allowed: readonly JobState[] = [
    "preflight",
    "profiling",
    "classifying",
    "mapping",
    "awaiting_review",
    "computing",
    "validating",
    "rendering",
  ];
  if (!allowed.includes(input.to))
    throw new JobStateError(
      "invalid_transition",
      `the browser cannot move a job to ${input.to}`,
    );
  const now = input.now ?? new Date();
  await withTransaction(pool, async (tx) => {
    const job = await lockJob(tx, input.jobId, input.accountId);
    if (job.state === input.to) return;
    await transition(tx, job, input.to);
    if (input.to === "awaiting_review" && job.reservation_id !== null) {
      // SPEC §19: the reservation is held while awaiting review (review TTL).
      const ttl = await readConfig(
        tx,
        "wallet.reservation_ttl_seconds",
        z.object({ review: z.number().int().positive() }),
      );
      await tx.query(
        `update public.reservations set kind = 'review', expires_at = $2 where id = $1 and status = 'held'`,
        [job.reservation_id, new Date(now.getTime() + ttl.review * 1000)],
      );
      await queueNotification(tx, {
        accountId: input.accountId,
        type: "job.awaiting_review",
        payload: { job_id: job.id, company_id: job.company_id },
        dedupeKey: `review:${job.id}`,
      });
    }
  });
}

export async function heartbeatJob(
  pool: Pool,
  input: { accountId: string; jobId: string; now?: Date },
): Promise<boolean> {
  const now = input.now ?? new Date();
  const r = await pool.query<{ reservation_id: string | null }>(
    `update public.jobs set heartbeat_at = $3 where id = $1 and account_id = $2 returning reservation_id`,
    [input.jobId, input.accountId, now],
  );
  const reservationId = r.rows[0]?.reservation_id ?? null;
  return reservationId === null ? false : heartbeatReservation(pool, reservationId, now);
}

export type { ActionKey };
