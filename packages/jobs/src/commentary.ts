/**
 * Commentary jobs (SPEC §25, §14 batch). The server builds the facts pack from the stored snapshot
 * (the account's own aggregates), queues the job, and delivers commentary either in real time
 * (Instant) or through Message Batches run by the worker (Standard). Output passes the V12
 * post-check inside the AI stage; the browser checks it again before substituting values.
 */

import {
  generateCommentary,
  jobAiContext,
  runJobAiStage,
  type AiTransport,
  type GenerateCommentaryInput,
  type GenerateCommentaryOutput,
} from "@magicmis/ai";
import { collectCommentaryBatch, submitCommentaryBatch } from "@magicmis/ai/batch";
import type { PeriodId } from "@magicmis/core/time";
import type { KeyWrapper } from "@magicmis/crypto";
import { currencySymbol } from "@magicmis/core/reporting-conventions";
import { readConfig } from "@magicmis/db/config";
import { withTransaction } from "@magicmis/db/tx";
import { buildFactsPack, type MetricValue } from "@magicmis/engine";
import { latestBlueprint, latestSnapshot } from "@magicmis/engine/server";
import { MONTHLY_FINANCIAL_MIS } from "@magicmis/templates";
import type { Pool } from "pg";
import { z } from "zod";

import { loadStageOutput, saveStageOutput } from "./checkpoints";
import { releasingOnLayoutFault } from "./layout-fault";
import { readStoredTemplate } from "./stored-layout";
import { completeCommentaryJob, failJob } from "./settle";
import { lockJob, transition } from "./states";

const INPUT_STAGE = "commentary_input";
const OUTPUT_STAGE = "commentary";

export class CommentaryError extends Error {
  constructor(
    readonly code: "no_snapshot" | "wrong_job" | "nothing_to_discuss",
    message: string,
  ) {
    super(message);
    this.name = "CommentaryError";
  }
}

/** Facts pack, sections and allowlist for a company period, from stored data and config. */
export async function commentaryInput(
  pool: Pool,
  wrapper: KeyWrapper,
  input: { accountId: string; companyId: string; period: PeriodId },
): Promise<GenerateCommentaryInput> {
  const snapshot = await latestSnapshot(pool, wrapper, { ...input });
  if (snapshot === null)
    throw new CommentaryError(
      "no_snapshot",
      "There is no MIS for that month yet. Run the refresh first.",
    );
  const company = await pool.query<{
    materiality_pct: string;
    materiality_abs_minor: string;
    currency: string;
    number_format: "lakhs_crores" | "absolute" | "millions";
  }>(
    `select materiality_pct::text as materiality_pct,
            materiality_abs_minor::text as materiality_abs_minor,
            currency, number_format
       from companies where id = $1`,
    [input.companyId],
  );
  const warnings = await pool.query<{
    validation_results: { id: string; status: string; severity: string }[];
  }>(
    `select validation_results from snapshots where company_id = $1 and period = $2 order by version desc limit 1`,
    [input.companyId, input.period],
  );
  const blueprint = await latestBlueprint(pool, wrapper, {
    accountId: input.accountId,
    companyId: input.companyId,
  });
  // The company's own sections, read strictly (ADR 0045): a layout that is saved but does not
  // parse stops a paid commentary rather than quietly structuring it by the standard headings.
  const template =
    blueprint === null ? null : readStoredTemplate(blueprint.parts.templateSpec);
  const own = template?.defaultCommentarySections ?? [];
  const allowlist = await readConfig(
    pool,
    "commentary.digit_allowlist",
    z.array(z.string()),
  );
  const pack = buildFactsPack({
    period: input.period,
    store: snapshot.metricStore.values as unknown as MetricValue[],
    materiality: {
      pct: company.rows[0]?.materiality_pct ?? "0.05",
      absMinor: company.rows[0]?.materiality_abs_minor ?? "0",
    },
    warnings: (warnings.rows[0]?.validation_results ?? [])
      .filter((r) => r.status === "fail" && r.severity === "warning")
      .map((r) => `Check ${r.id} raised a warning for this month.`),
    // The figures handed to the model are written in the company's own currency and
    // grouping (ADR 0030), so the commentary reads in the same units as the workbook
    // beside it rather than in rupees regardless.
    conventions: {
      currencySymbol: currencySymbol(company.rows[0]?.currency ?? "INR"),
      numberFormat: company.rows[0]?.number_format ?? "lakhs_crores",
    },
  });
  if (pack.facts.length === 0)
    throw new CommentaryError(
      "nothing_to_discuss",
      "The MIS for that month has no figures to discuss.",
    );
  return {
    factsPack: {
      period: pack.period,
      facts: [...pack.facts],
      dimensions: [...pack.dimensions],
      periods: [...pack.periods],
      warnings: [...pack.warnings],
    },
    sections: own.length > 0 ? own : MONTHLY_FINANCIAL_MIS.defaultCommentarySections,
    allowlist,
  };
}

/** After the price is confirmed: store the input and queue the job. */
export async function queueCommentary(
  pool: Pool,
  wrapper: KeyWrapper,
  input: { accountId: string; jobId: string; period: PeriodId },
): Promise<{ delivery: "standard" | "instant" }> {
  const job = await withTransaction(pool, (tx) =>
    lockJob(tx, input.jobId, input.accountId),
  );
  if (job.type !== "commentary" || job.company_id === null)
    throw new CommentaryError("wrong_job", "This is not a commentary job.");
  if (job.state === "commentary_queued") return { delivery: job.delivery_mode };
  const companyId = job.company_id;
  const payload = await releasingOnLayoutFault(
    pool,
    { accountId: input.accountId, jobId: job.id },
    () =>
      commentaryInput(pool, wrapper, {
        accountId: input.accountId,
        companyId,
        period: input.period,
      }),
  );
  await saveStageOutput(pool, wrapper, {
    accountId: input.accountId,
    companyId: job.company_id,
    jobId: job.id,
    stage: INPUT_STAGE,
    output: payload,
  });
  await withTransaction(pool, async (tx) =>
    transition(tx, await lockJob(tx, job.id, input.accountId), "commentary_queued", {
      checkpoint: { period: input.period },
    }),
  );
  return { delivery: job.delivery_mode };
}

async function storeAndComplete(
  pool: Pool,
  wrapper: KeyWrapper,
  job: { accountId: string; companyId: string; jobId: string },
  output: GenerateCommentaryOutput,
  now: Date,
) {
  await saveStageOutput(pool, wrapper, { ...job, stage: OUTPUT_STAGE, output });
  await completeCommentaryJob(pool, { accountId: job.accountId, jobId: job.jobId, now });
}

async function realtime(
  pool: Pool,
  wrapper: KeyWrapper,
  transport: AiTransport,
  job: { accountId: string; companyId: string; jobId: string },
  input: GenerateCommentaryInput,
  now: Date,
) {
  try {
    const ctx = await jobAiContext(pool, transport, job.jobId);
    const outcome = await runJobAiStage(ctx, (c) => generateCommentary(c, input), now);
    if (outcome.status === "paused") return "paused" as const;
    await storeAndComplete(pool, wrapper, job, outcome.value.output, now);
    return "completed" as const;
  } catch (error) {
    await failJob(pool, {
      accountId: job.accountId,
      jobId: job.jobId,
      failureClass: "platform_fault",
      code: "commentary_failed",
      detail: "Commentary could not be generated. No credits were charged.",
      reportedBy: "server",
      now,
    });
    if (
      error instanceof Error &&
      (error.name === "AiStageError" || error.name === "RoutingError")
    )
      return "failed" as const;
    throw error;
  }
}

/** Instant delivery: generate now, in the request. */
export async function runInstantCommentary(
  pool: Pool,
  wrapper: KeyWrapper,
  transport: AiTransport,
  input: { accountId: string; jobId: string; now?: Date },
): Promise<"completed" | "paused" | "failed"> {
  const now = input.now ?? new Date();
  const job = await withTransaction(pool, (tx) =>
    lockJob(tx, input.jobId, input.accountId),
  );
  if (job.company_id === null)
    throw new CommentaryError("wrong_job", "This is not a commentary job.");
  const scope = { accountId: input.accountId, companyId: job.company_id, jobId: job.id };
  const payload = (await loadStageOutput(pool, wrapper, {
    ...scope,
    stage: INPUT_STAGE,
  })) as GenerateCommentaryInput | null;
  if (payload === null)
    throw new CommentaryError("wrong_job", "Commentary has not been queued.");
  return realtime(pool, wrapper, transport, scope, payload, now);
}

interface QueuedJob {
  id: string;
  account_id: string;
  company_id: string;
  stage_checkpoints: Record<string, unknown>;
}

/**
 * Worker tick (Standard delivery): submit queued jobs as one Message Batch, collect finished
 * batches, complete jobs whose output passed, and rerun the rest in real time (which repairs once).
 */
export async function commentaryBatchTick(
  pool: Pool,
  wrapper: KeyWrapper,
  transport: AiTransport,
  now: Date = new Date(),
): Promise<{ submitted: number; completed: number; retried: number }> {
  const queued = await pool.query<QueuedJob>(
    `select id, account_id, company_id, stage_checkpoints from jobs
     where type = 'commentary' and state = 'commentary_queued' and delivery_mode = 'standard' and company_id is not null
     order by created_at limit 500`,
  );
  const items = [];
  for (const j of queued.rows) {
    const scope = { accountId: j.account_id, companyId: j.company_id, jobId: j.id };
    const input = (await loadStageOutput(pool, wrapper, {
      ...scope,
      stage: INPUT_STAGE,
    })) as GenerateCommentaryInput | null;
    if (input === null) continue;
    items.push({
      job: j,
      scope,
      input,
      customId: `job_${j.id.replace(/-/gu, "")}`,
      ctx: await jobAiContext(pool, transport, j.id),
    });
  }

  let submitted = 0;
  const unsubmitted = items.filter(
    (i) => i.job.stage_checkpoints["batch_id"] === undefined,
  );
  if (unsubmitted.length > 0) {
    try {
      const batch = await submitCommentaryBatch(
        unsubmitted.map((i) => ({ customId: i.customId, ctx: i.ctx, input: i.input })),
      );
      for (const i of unsubmitted) {
        await pool.query(
          `update jobs set stage_checkpoints = stage_checkpoints || jsonb_build_object('batch_id', $2::text) where id = $1`,
          [i.job.id, batch.batchId],
        );
        i.job.stage_checkpoints["batch_id"] = batch.batchId;
      }
      submitted = unsubmitted.length;
    } catch (error) {
      // A cap or availability problem for any item: fall back to real time, which pauses or fails per job.
      if (!(
        error instanceof Error &&
        ["RuntimeCapExceeded", "AiStageError", "RoutingError"].includes(error.name)
      ))
        throw error;
      for (const i of unsubmitted)
        await realtime(pool, wrapper, transport, i.scope, i.input, now);
      return { submitted: 0, completed: 0, retried: unsubmitted.length };
    }
  }

  let completed = 0;
  let retried = 0;
  const byBatch = new Map<string, typeof items>();
  for (const i of items) {
    const batchId = i.job.stage_checkpoints["batch_id"];
    if (typeof batchId !== "string" || unsubmitted.includes(i)) continue;
    byBatch.set(batchId, [...(byBatch.get(batchId) ?? []), i]);
  }
  for (const [batchId, group] of byBatch) {
    const results = await collectCommentaryBatch(
      batchId,
      group.map((i) => ({ customId: i.customId, ctx: i.ctx, input: i.input })),
    );
    if (results === null) continue;
    for (const r of results) {
      const item = group.find((g) => g.customId === r.customId);
      if (item === undefined) continue;
      if (r.status === "ok") {
        await storeAndComplete(pool, wrapper, item.scope, r.output, now);
        completed += 1;
      } else {
        retried += 1;
        if (
          (await realtime(pool, wrapper, transport, item.scope, item.input, now)) ===
          "completed"
        )
          completed += 1;
      }
    }
  }
  return { submitted, completed, retried };
}

/** The stored commentary and the metric values its placeholders refer to, for the owner's browser. */
export async function commentaryForJob(
  pool: Pool,
  wrapper: KeyWrapper,
  input: { accountId: string; jobId: string },
): Promise<{ output: GenerateCommentaryOutput; input: GenerateCommentaryInput } | null> {
  const job = await pool.query<{ company_id: string | null; state: string }>(
    `select company_id, state from jobs where id = $1 and account_id = $2`,
    [input.jobId, input.accountId],
  );
  const row = job.rows[0];
  if (row === undefined || row.company_id === null || row.state !== "completed")
    return null;
  const scope = {
    accountId: input.accountId,
    companyId: row.company_id,
    jobId: input.jobId,
  };
  const output = (await loadStageOutput(pool, wrapper, {
    ...scope,
    stage: OUTPUT_STAGE,
  })) as GenerateCommentaryOutput | null;
  const payload = (await loadStageOutput(pool, wrapper, {
    ...scope,
    stage: INPUT_STAGE,
  })) as GenerateCommentaryInput | null;
  return output === null || payload === null ? null : { output, input: payload };
}
