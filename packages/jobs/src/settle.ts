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
  BlueprintConflict,
  latestBlueprint,
  sealForCompany,
  storeBlueprint,
  storeSnapshot,
  type BlueprintParts,
} from "@magicmis/engine/server";
import type { SnapshotPayload } from "@magicmis/engine";
import { captureReservation, priceFor, releaseReservation } from "@magicmis/wallet";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";

import { jobChargeBase, jobPrice, type JobType, type PricedTier } from "./jobs";
import { queueNotification } from "./notify";
import {
  JobStateError,
  lockJob,
  TERMINAL,
  transition,
  type JobRow,
  type JobState,
} from "./states";

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

/**
 * `required` is set by the one caller that is charging for something the customer now has
 * (ADR 0057). A hold that has gone and captured nothing means the reservation was released
 * underneath us — a cancel that landed while the workbook was being written — and answering 0
 * there let `completeJob` mark the job delivered for free. It has to be an error, so the job is
 * not completed and the output is not reachable.
 */
async function capture(
  pool: Pool,
  job: JobRow,
  amount: bigint,
  label: string,
  now: Date,
  required = false,
): Promise<bigint> {
  if (job.reservation_id === null) {
    if (required) throw new JobStateError("no_hold", "this job holds no credits");
    return 0n;
  }
  const held = await heldAmount(pool, job.reservation_id);
  if (held === 0n) {
    const prior = await pool.query<{ captured_amount: string | null }>(
      `select captured_amount::text as captured_amount from public.reservations where id = $1`,
      [job.reservation_id],
    );
    const already = BigInt(prior.rows[0]?.captured_amount ?? "0");
    // Already captured is the resume case and is fine. Nothing captured is not.
    if (required && already === 0n)
      throw new JobStateError(
        "no_hold",
        "the credits for this job were released before it was delivered",
      );
    return already;
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

export async function finish(
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
  /**
   * What happens to the MIS layout the company already has. `keep` (the default) carries it into
   * the new version whatever `blueprint.templateSpec` says, so `templateSpec` is only the layout
   * of a company that has none yet. `replace` is for the one action that asks for a new layout:
   * recreating a reference MIS. A run reads its template minutes before it finishes; without this
   * it would write that copy back over a row renamed in the meantime (ADR 0045).
   */
  readonly layout?: "keep" | "replace";
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
 * A run's new blueprint version: its rules, recipe and fingerprints, and **the company's own
 * layout** (ADR 0045). What a company named its tables and rows, and how it arranged its dashboard,
 * is read from the newest version at the moment of writing and carried into this one **exactly as
 * stored**. It is copied, never interpreted, so it is not parsed here: a copy loses nothing even
 * of a layout that no longer parses, whereas refusing at this point would fail a run after all of
 * its AI spend. Whoever renders from a layout reads it strictly, and does so before spending
 * (`stored-layout.ts`). If an edit lands between the read and the write the writer refuses
 * (`BlueprintConflict`) and this reads again, so neither the run nor the edit is lost.
 */
async function storeRunBlueprint(
  pool: Pool,
  wrapper: KeyWrapper,
  input: {
    accountId: string;
    companyId: string;
    jobId: string;
    parts: BlueprintParts;
    layout: "keep" | "replace";
  },
): Promise<number> {
  const scope = { accountId: input.accountId, companyId: input.companyId };
  for (let attempt = 1; ; attempt += 1) {
    const previous = await latestBlueprint(pool, wrapper, scope);
    const keep =
      input.layout === "keep" && previous !== null && previous.parts.templateSpec != null;
    try {
      const stored = await storeBlueprint(pool, wrapper, {
        ...scope,
        jobId: input.jobId,
        parts: {
          ...input.parts,
          templateSpec: keep ? previous.parts.templateSpec : input.parts.templateSpec,
          // Materiality is part of the layout it was chosen with.
          materiality: keep ? previous.parts.materiality : input.parts.materiality,
          dashboardSpec:
            input.parts.dashboardSpec ?? previous?.parts.dashboardSpec ?? null,
        },
        basedOn: previous?.version ?? null,
      });
      return stored.version;
    } catch (error) {
      if (!(error instanceof BlueprintConflict) || attempt >= 4) throw error;
    }
  }
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
    blueprintVersion = await storeRunBlueprint(pool, wrapper, {
      accountId: input.accountId,
      companyId,
      jobId: job.id,
      parts: input.blueprint,
      layout: input.layout ?? "keep",
    });
    await checkpoint({ blueprint_version: blueprintVersion });
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

  const captured = await captureDelivered(pool, job, now);

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

/** Captures the job's price, or the delivered (lower) tier's price after a model fallback (SPEC §14). */
export async function captureDelivered(
  pool: Pool,
  job: JobRow,
  now: Date,
): Promise<bigint> {
  const base = await jobChargeBase(pool, job.id);
  const delivered = job.stage_checkpoints["delivered_tier"] as PricedTier | undefined;
  let amount = base;
  if (
    delivered !== undefined &&
    TIER_ORDER.indexOf(delivered) < TIER_ORDER.indexOf(pricedTier(job.tier))
  ) {
    const lower = await jobPrice(pool, {
      type: job.type as JobType,
      tier: delivered,
      delivery: job.delivery_mode,
      // As sold, not as priced today (ADR 0057).
      at: job.created_at,
    });
    amount = min(base, lower.credits);
  }
  return capture(pool, job, amount, "capture", now, true);
}

/**
 * Commentary completion (SPEC §25): the output is already stored as the job's checkpoint; move
 * commentary_queued → commentary_done → completed, capture and notify.
 */
export async function completeCommentaryJob(
  pool: Pool,
  input: { accountId: string; jobId: string; now?: Date },
): Promise<{ captured: bigint }> {
  const now = input.now ?? new Date();
  const job = await withTransaction(pool, async (tx) => {
    const locked = await lockJob(tx, input.jobId, input.accountId);
    if (locked.state === "commentary_queued")
      await transition(tx, locked, "commentary_done");
    return locked;
  });
  if (job.state === "completed") return { captured: BigInt(job.captured_credits ?? "0") };
  const captured = await captureDelivered(pool, job, now);
  await queueNotification(pool, {
    accountId: input.accountId,
    type: "job.completed",
    payload: { job_id: job.id, company_id: job.company_id, job_type: job.type },
    dedupeKey: `completed:${job.id}`,
  });
  await withTransaction(pool, async (tx) => {
    const locked = await lockJob(tx, job.id, job.account_id);
    if (locked.state === "completed") return;
    await transition(tx, locked, "completed");
    await tx.query(`update public.jobs set captured_credits = $2 where id = $1`, [
      job.id,
      captured.toString(),
    ]);
  });
  await syncJobAiCost(pool, job.id);
  return { captured };
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
  // Any terminal state, not only the two failures (ADR 0057). A job that completed, was
  // cancelled or expired has already been settled; running the platform-fault branch over it
  // wrote a "charged 0" notice to a customer who had just been charged in full, and counted the
  // run's AI cost as absorbed on top of a captured job — before `finish` threw anyway.
  if (TERMINAL.has(job.state)) {
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
    at: job.created_at,
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
      at: job.created_at,
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

/**
 * Cancelling a run mid-AI is allowed and keeps the cancel-after-AI fee (SPEC §23). Cancelling
 * once it is **rendering** is not (ADR 0057): that is the window in which `completeJob` writes
 * the snapshot, the blueprint and the workbook, none of it in one transaction with the capture.
 * A cancel landing inside it released the hold, the workbook was already stored, and the job
 * settled as cancelled with nothing captured. The worker's sweep still expires an abandoned
 * render, which charges the fee rather than releasing the hold.
 */
const DELIVERING: ReadonlySet<JobState> = new Set(["rendering", "commentary_done"]);

export async function cancelJob(
  pool: Pool,
  input: { accountId: string; jobId: string; now?: Date },
): Promise<{ captured: bigint }> {
  const now = input.now ?? new Date();
  const job = await withTransaction(pool, (tx) =>
    lockJob(tx, input.jobId, input.accountId),
  );
  if (TERMINAL.has(job.state)) return { captured: BigInt(job.captured_credits ?? "0") };
  if (DELIVERING.has(job.state))
    throw new JobStateError(
      "already_running",
      "this job is being delivered and can no longer be cancelled",
    );
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
  // One job that cannot be settled must not stop the rest, nor skip the review reminders
  // below it (ADR 0053). Failures are collected and thrown once the sweep has finished.
  const failures: unknown[] = [];
  for (const d of due.rows) {
    try {
      const job = await withTransaction(pool, (tx) => lockJob(tx, d.id, d.account_id));
      await cancelLike(pool, job, "expired", now);
      expired += 1;
    } catch (error) {
      failures.push(error);
    }
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
    try {
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
    } catch (error) {
      failures.push(error);
    }
  }
  // Everything that could be swept has been. Now say what could not, so it reaches the worker's
  // error reporting rather than a silent count.
  if (failures.length > 0)
    throw new AggregateError(failures, `sweepJobs: ${failures.length.toString()} failed`);
  return { expired, reminded };
}
