/**
 * Charge points (SPEC §23), exactly:
 *
 * | Outcome                                   | Credits                                              |
 * |-------------------------------------------|------------------------------------------------------|
 * | Completed                                 | full price, or the delivered (downgraded) tier price |
 * | data_fault (preflight or later)           | `data_diagnostic` price; diagnostic report delivered |
 * | platform_fault                            | release everything; absorbed AI cost recorded        |
 * | Cancelled before any AI call              | release everything                                   |
 * | Cancelled after an AI call                | `cancel_after_ai_fee`; remainder released            |
 * | Expired awaiting review                   | as cancelled after an AI call                        |
 * | Runtime cap                               | handled in `@magicmis/ai` (release, quote)           |
 *
 * A capture never exceeds what was held. Browser-reported platform faults release credits at most
 * `jobs.platform_fault_release_limit` times per window; beyond that the job is charged as a data
 * fault and an audit entry flags it (ADR 0021), so a modified client cannot compute for free.
 */

import { appendAudit } from "@magicmis/db/audit";
import { readConfig } from "@magicmis/db/config";
import { withTransaction } from "@magicmis/db/tx";
import type { KeyWrapper } from "@magicmis/crypto";
import {
  sealForCompany,
  storeBlueprint,
  storeSnapshot,
  type BlueprintParts,
} from "@magicmis/engine/server";
import type { SnapshotPayload } from "@magicmis/engine";
import {
  captureReservation,
  priceFor,
  releaseReservation,
  type ActionKey,
} from "@magicmis/wallet";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";

import { jobChargeBase, type PricedTier } from "./jobs";
import { queueNotification } from "./notify";
import { lockJob, transition, type JobRow, type JobState } from "./states";

export interface OutputStore {
  put(path: string, bytes: Buffer, contentType: string): Promise<void>;
  get(path: string): Promise<Buffer>;
  remove(paths: readonly string[]): Promise<void>;
}

/** Totals the job's recorded AI cost onto the job row (same as @magicmis/ai, without its server-only client). */
async function syncJobAiCost(pool: Pool, jobId: string): Promise<void> {
  await pool.query(
    `update public.jobs j set actual_ai_cost_micro_usd = c.usd, actual_ai_cost_paise = c.paise
     from (select coalesce(sum(usd_cost_micro), 0) as usd, coalesce(sum(inr_cost_paise), 0) as paise
           from public.ai_calls where job_id = $1) c
     where j.id = $1`,
    [jobId],
  );
}

const TIER_ORDER: readonly PricedTier[] = ["efficient", "professional", "expert"];
const pricedTier = (t: JobRow["tier"]): PricedTier =>
  t === "expert_plus" ? "expert" : t;
const min = (a: bigint, b: bigint) => (a < b ? a : b);

async function heldAmount(pool: Pool, reservationId: string | null): Promise<bigint> {
  if (reservationId === null) return 0n;
  const r = await pool.query<{ amount: string; status: string }>(
    `select amount::text as amount, status from public.reservations where id = $1`,
    [reservationId],
  );
  const row = r.rows[0];
  return row === undefined || row.status !== "held" ? 0n : BigInt(row.amount);
}

async function aiCallCount(pool: Pool, jobId: string): Promise<number> {
  const r = await pool.query<{ n: number }>(
    `select count(*)::int as n from public.ai_calls where job_id = $1`,
    [jobId],
  );
  return r.rows[0]?.n ?? 0;
}

async function capture(
  pool: Pool,
  job: JobRow,
  amount: bigint,
  label: string,
  now: Date,
): Promise<bigint> {
  if (job.reservation_id === null) return 0n;
  const held = await heldAmount(pool, job.reservation_id);
  if (held === 0n) {
    const prior = await pool.query<{ captured_amount: string | null }>(
      `select captured_amount::text as captured_amount from public.reservations where id = $1`,
      [job.reservation_id],
    );
    return BigInt(prior.rows[0]?.captured_amount ?? "0");
  }
  const result = await captureReservation(pool, {
    reservationId: job.reservation_id,
    amount: min(amount, held),
    idempotencyKey: `job:${job.id}:${label}`,
    now,
  });
  return result.captured;
}

async function release(pool: Pool, job: JobRow, label: string, now: Date): Promise<void> {
  if (job.reservation_id === null) return;
  await releaseReservation(pool, {
    reservationId: job.reservation_id,
    idempotencyKey: `job:${job.id}:${label}`,
    now,
  });
}

async function finish(
  pool: Pool,
  job: JobRow,
  to: JobState,
  captured: bigint,
  failure?: { class: string; code: string; detail: string },
): Promise<void> {
  await withTransaction(pool, async (tx) => {
    const locked = await lockJob(tx, job.id, job.account_id);
    if (locked.state === to) return;
    await transition(tx, locked, to, failure === undefined ? {} : { failure });
    await tx.query(`update public.jobs set captured_credits = $2 where id = $1`, [
      job.id,
      captured.toString(),
    ]);
  });
  await syncJobAiCost(pool, job.id);
}

export interface CompletionInput {
  readonly accountId: string;
  readonly jobId: string;
  readonly snapshot: SnapshotPayload;
  /** A new blueprint version when the template, recipe or rules changed; null keeps the current one. */
  readonly blueprint: BlueprintParts | null;
  readonly output: { readonly fileName: string; readonly bytes: Buffer } | null;
  readonly outputStore: OutputStore;
  readonly now?: Date;
}

export interface CompletionResult {
  readonly captured: bigint;
  readonly snapshotVersion: number;
  readonly blueprintVersion: number | null;
  readonly outputId: string | null;
}

/**
 * Completion: store snapshot, blueprint and output (each once, recorded in the job's checkpoints
 * so a retry never duplicates), capture the price of the tier delivered, set the memory-fee anchor
 * on first setup, and complete.
 */
export async function completeJob(
  pool: Pool,
  wrapper: KeyWrapper,
  input: CompletionInput,
): Promise<CompletionResult> {
  const now = input.now ?? new Date();
  const job = await withTransaction(pool, (tx) =>
    lockJob(tx, input.jobId, input.accountId),
  );
  if (
    job.state !== "rendering" &&
    job.state !== "commentary_done" &&
    job.state !== "completed"
  ) {
    throw new Error(`cannot complete a job in ${job.state}`);
  }
  if (job.company_id === null) throw new Error("job has no company");
  const companyId = job.company_id;
  const cp = job.stage_checkpoints;
  const checkpoint = async (patch: Record<string, unknown>) =>
    pool.query(
      `update public.jobs set stage_checkpoints = stage_checkpoints || $2::jsonb where id = $1`,
      [job.id, JSON.stringify(patch)],
    );

  let snapshotVersion = cp["snapshot_version"] as number | undefined;
  if (snapshotVersion === undefined) {
    const s = await storeSnapshot(pool, wrapper, {
      accountId: input.accountId,
      companyId,
      jobId: job.id,
      payload: input.snapshot,
    });
    snapshotVersion = s.version;
    await checkpoint({ snapshot_version: s.version, snapshot_id: s.snapshotId });
  }

  let blueprintVersion = (cp["blueprint_version"] as number | undefined) ?? null;
  if (blueprintVersion === null && input.blueprint !== null) {
    const b = await storeBlueprint(pool, wrapper, {
      accountId: input.accountId,
      companyId,
      jobId: job.id,
      parts: input.blueprint,
    });
    blueprintVersion = b.version;
    await checkpoint({ blueprint_version: b.version });
  }

  let outputId = (cp["output_id"] as string | undefined) ?? null;
  if (outputId === null && input.output !== null) {
    const retentionDays = await readConfig(
      pool,
      "outputs.retention_days",
      z.number().int().positive(),
    );
    const inserted = await pool.query<{ id: string }>(
      `insert into public.outputs (company_id, account_id, job_id, type, storage_path, byte_size, expires_at, sha256, file_name)
       values ($1, $2, $3, 'excel', '', $4, $5, $6, $7) returning id`,
      [
        companyId,
        input.accountId,
        job.id,
        input.output.bytes.length,
        new Date(now.getTime() + retentionDays * 86_400_000),
        createHash("sha256").update(input.output.bytes).digest("hex"),
        input.output.fileName,
      ],
    );
    const id = inserted.rows[0]?.id ?? "";
    const sealed = await sealForCompany(pool, wrapper, {
      accountId: input.accountId,
      companyId,
      purpose: "output",
      id,
      plaintext: input.output.bytes,
    });
    const path = `${input.accountId}/${companyId}/${id}.bin`;
    await input.outputStore.put(path, sealed, "application/octet-stream");
    await pool.query(`update public.outputs set storage_path = $2 where id = $1`, [
      id,
      path,
    ]);
    outputId = id;
    await checkpoint({ output_id: id });
  }

  // Price of the tier actually delivered (SPEC §14: a fallback to a lower tier's model).
  const base = await jobChargeBase(pool, job.id);
  const delivered = cp["delivered_tier"] as PricedTier | undefined;
  let amount = base;
  if (
    delivered !== undefined &&
    TIER_ORDER.indexOf(delivered) < TIER_ORDER.indexOf(pricedTier(job.tier))
  ) {
    const lower = await priceFor(pool, {
      actionKey: job.type as ActionKey,
      tier: delivered,
      delivery: job.delivery_mode,
      at: now,
    });
    amount = min(base, lower.credits);
  }
  const captured = await capture(pool, job, amount, "capture", now);

  await withTransaction(pool, async (tx) => {
    await tx.query(
      `update public.companies set first_setup_at = coalesce(first_setup_at, $2),
         memory_fee_anchor_date = coalesce(memory_fee_anchor_date, ($2 at time zone 'Asia/Kolkata')::date)
       where id = $1 and $3`,
      [
        companyId,
        now,
        job.type === "company_setup" || job.type === "reference_mis_recreate",
      ],
    );
    await queueNotification(tx, {
      accountId: input.accountId,
      type: "job.completed",
      payload: { job_id: job.id, company_id: companyId, job_type: job.type },
      dedupeKey: `completed:${job.id}`,
    });
  });
  await finish(pool, job, "completed", captured);
  return { captured, snapshotVersion, blueprintVersion, outputId };
}

export type FailureReporter = "browser" | "server";

export async function failJob(
  pool: Pool,
  input: {
    accountId: string;
    jobId: string;
    failureClass: "data_fault" | "platform_fault";
    code: string;
    /** Plain reason and fix; no figures from customer data. */
    detail: string;
    reportedBy: FailureReporter;
    now?: Date;
  },
): Promise<{ state: JobState; captured: bigint; downgradedToDataFault: boolean }> {
  const now = input.now ?? new Date();
  const job = await withTransaction(pool, (tx) =>
    lockJob(tx, input.jobId, input.accountId),
  );
  if (job.state === "failed_data" || job.state === "failed_platform") {
    return {
      state: job.state,
      captured: BigInt(job.captured_credits ?? "0"),
      downgradedToDataFault: false,
    };
  }

  let failureClass = input.failureClass;
  let downgraded = false;
  if (failureClass === "platform_fault" && input.reportedBy === "browser") {
    const limit = await readConfig(
      pool,
      "jobs.platform_fault_release_limit",
      z.number().int().nonnegative(),
    );
    const days = await readConfig(
      pool,
      "jobs.platform_fault_window_days",
      z.number().int().positive(),
    );
    const recent = await pool.query<{ n: number }>(
      `select count(*)::int as n from public.jobs
       where account_id = $1 and state = 'failed_platform' and completed_at > $2`,
      [input.accountId, new Date(now.getTime() - days * 86_400_000)],
    );
    if ((recent.rows[0]?.n ?? 0) >= limit) {
      failureClass = "data_fault";
      downgraded = true;
      await withTransaction(pool, (tx) =>
        appendAudit(tx, {
          actorType: "system",
          action: "job.platform_fault_limit_reached",
          targetType: "job",
          targetId: job.id,
          metadata: { reported_code: input.code, limit },
        }),
      );
    }
  }

  if (failureClass === "platform_fault") {
    await release(pool, job, "release_platform_fault", now);
    await syncJobAiCost(pool, job.id);
    const cost = await pool.query<{ usd: string; paise: string }>(
      `select actual_ai_cost_micro_usd::text as usd, actual_ai_cost_paise::text as paise from public.jobs where id = $1`,
      [job.id],
    );
    const usd = BigInt(cost.rows[0]?.usd ?? "0");
    await withTransaction(pool, async (tx) => {
      if (usd > 0n) {
        await tx.query(
          `insert into public.margin_events (kind, account_id, job_id, cost_micro_usd, cost_paise, detail, created_at)
           values ('platform_absorbed', $1, $2, $3, $4, $5, $6)`,
          [
            input.accountId,
            job.id,
            usd.toString(),
            cost.rows[0]?.paise ?? "0",
            JSON.stringify({ code: input.code }),
            now,
          ],
        );
      }
      await appendAudit(tx, {
        actorType: "system",
        action: "job.platform_fault",
        targetType: "job",
        targetId: job.id,
        metadata: { code: input.code, reported_by: input.reportedBy },
      });
      await queueNotification(tx, {
        accountId: input.accountId,
        type: "job.failed",
        payload: { job_id: job.id, failure_class: "platform_fault", charged: "0" },
        dedupeKey: `failed:${job.id}`,
      });
    });
    await finish(pool, job, "failed_platform", 0n, {
      class: "platform_fault",
      code: input.code,
      detail: input.detail,
    });
    return { state: "failed_platform", captured: 0n, downgradedToDataFault: false };
  }

  const diagnostic = await priceFor(pool, {
    actionKey: "data_diagnostic",
    tier: pricedTier(job.tier),
    delivery: job.delivery_mode,
    at: now,
  });
  const captured = await capture(
    pool,
    job,
    diagnostic.credits,
    "capture_data_fault",
    now,
  );
  await queueNotification(pool, {
    accountId: input.accountId,
    type: "job.failed",
    payload: {
      job_id: job.id,
      failure_class: "data_fault",
      charged: captured.toString(),
    },
    dedupeKey: `failed:${job.id}`,
  });
  await finish(pool, job, "failed_data", captured, {
    class: "data_fault",
    code: input.code,
    detail: input.detail,
  });
  return { state: "failed_data", captured, downgradedToDataFault: downgraded };
}

async function cancelLike(
  pool: Pool,
  job: JobRow,
  to: "cancelled" | "expired",
  now: Date,
): Promise<bigint> {
  let captured = 0n;
  if ((await aiCallCount(pool, job.id)) > 0) {
    const fee = await priceFor(pool, {
      actionKey: "cancel_after_ai_fee",
      tier: pricedTier(job.tier),
      delivery: job.delivery_mode,
      at: now,
    });
    captured = await capture(pool, job, fee.credits, `capture_${to}`, now);
  } else {
    await release(pool, job, `release_${to}`, now);
  }
  await finish(pool, job, to, captured, {
    class: to === "expired" ? "expired" : "user_cancelled",
    code: to,
    detail: "",
  });
  return captured;
}

export async function cancelJob(
  pool: Pool,
  input: { accountId: string; jobId: string; now?: Date },
): Promise<{ captured: bigint }> {
  const now = input.now ?? new Date();
  const job = await withTransaction(pool, (tx) =>
    lockJob(tx, input.jobId, input.accountId),
  );
  if (job.state === "cancelled") return { captured: BigInt(job.captured_credits ?? "0") };
  return { captured: await cancelLike(pool, job, "cancelled", now) };
}

/**
 * Worker sweep (SPEC §19, §23): review reservations past expiry expire the job with the
 * cancel-after-AI charge; abandoned running jobs that made AI calls likewise. A reminder goes out
 * `jobs.review_reminder_hours` before a review reservation expires.
 */
export async function sweepJobs(
  pool: Pool,
  now: Date = new Date(),
): Promise<{ expired: number; reminded: number }> {
  const stale = await readConfig(
    pool,
    "wallet.heartbeat_stale_seconds",
    z.number().int().positive(),
  );
  const reminderHours = await readConfig(
    pool,
    "jobs.review_reminder_hours",
    z.number().int().positive(),
  );
  const due = await pool.query<{ id: string; account_id: string }>(
    `select j.id, j.account_id from public.jobs j join public.reservations r on r.id = j.reservation_id
     where r.status = 'held' and r.expires_at < $1 and (r.heartbeat_at is null or r.heartbeat_at < $2)
       and (j.state = 'awaiting_review' or exists (select 1 from public.ai_calls c where c.job_id = j.id))
       and j.state not in ('completed', 'failed_data', 'failed_platform', 'cancelled', 'expired')`,
    [now, new Date(now.getTime() - stale * 1000)],
  );
  let expired = 0;
  for (const d of due.rows) {
    const job = await withTransaction(pool, (tx) => lockJob(tx, d.id, d.account_id));
    await cancelLike(pool, job, "expired", now);
    expired += 1;
  }
  const soon = await pool.query<{
    id: string;
    account_id: string;
    company_id: string | null;
    expires_at: Date;
  }>(
    `select j.id, j.account_id, j.company_id, r.expires_at from public.jobs j join public.reservations r on r.id = j.reservation_id
     where j.state = 'awaiting_review' and r.status = 'held' and r.expires_at > $1 and r.expires_at <= $2`,
    [now, new Date(now.getTime() + reminderHours * 3_600_000)],
  );
  let reminded = 0;
  for (const j of soon.rows) {
    if (
      await queueNotification(pool, {
        accountId: j.account_id,
        type: "job.review_expiring",
        payload: {
          job_id: j.id,
          company_id: j.company_id,
          expires_at: j.expires_at.toISOString(),
        },
        dedupeKey: `review_expiring:${j.id}`,
      })
    )
      reminded += 1;
  }
  return { expired, reminded };
}
