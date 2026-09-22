/**
 * "Where to act" as a paid job (ADR 0062).
 *
 * The same machine every other paid action runs on: the credits are held on confirm, the stage
 * runs in the request, the output is sealed under the company key, and the job settles —
 * captured on delivery, released in full on a platform fault. It borrows commentary's
 * `commentary_queued` / `commentary_done` states rather than adding two of its own: the states
 * mean "an AI write-up is queued" and "it is written", which is exactly what happens here, and
 * `completeCommentaryJob` has never looked at the job's type.
 *
 * Instant only, because every run is instant (ADR 0050). There is no batch path.
 */

import {
  boardActionsInput,
  jobAiContext,
  runJobAiStage,
  suggestBoardActions,
  type AiTransport,
  type BoardActionsInput,
  type BoardActionsOutput,
} from "@magicmis/ai";
import type { PeriodId } from "@magicmis/core/time";
import type { KeyWrapper } from "@magicmis/crypto";
import { readConfig } from "@magicmis/db/config";
import { withTransaction } from "@magicmis/db/tx";
import type { Pool } from "pg";
import { z } from "zod";

import { loadStageOutput, saveStageOutput } from "./checkpoints";
import { factsPackFor, CommentaryError } from "./commentary";
import { releasingOnLayoutFault } from "./layout-fault";
import { completeCommentaryJob, failJob } from "./settle";
import { lockJob, transition } from "./states";

const INPUT_STAGE = "board_actions_input";
const OUTPUT_STAGE = "board_actions";

/** Five is what a board reads. Config, like every other business number (SPEC §0.5). */
async function maxActions(pool: Pool): Promise<number> {
  return readConfig(
    pool,
    "board_actions.max_actions",
    z.number().int().min(3).max(8),
  ).catch(() => 5);
}

/**
 * The input, built from the month's own figures. Throws a `CommentaryError` for everything the
 * customer can fix — a hidden month, a month with no MIS, a month with nothing in it — which the
 * caller turns into a released hold rather than a charge.
 */
export async function boardActionsInputFor(
  pool: Pool,
  wrapper: KeyWrapper,
  input: { accountId: string; companyId: string; period: PeriodId },
): Promise<BoardActionsInput> {
  const { pack, allowlist } = await factsPackFor(pool, wrapper, input);
  return boardActionsInput.parse({
    factsPack: {
      period: pack.period,
      facts: [...pack.facts],
      dimensions: [...pack.dimensions],
      periods: [...pack.periods],
      warnings: [...pack.warnings],
    },
    allowlist,
    maxActions: await maxActions(pool),
  });
}

/** After the price is confirmed: build the input, store it, and mark the job queued. */
export async function queueBoardActions(
  pool: Pool,
  wrapper: KeyWrapper,
  input: { accountId: string; jobId: string; period: PeriodId },
): Promise<void> {
  const job = await withTransaction(pool, (tx) =>
    lockJob(tx, input.jobId, input.accountId),
  );
  if (job.type !== "board_actions" || job.company_id === null)
    throw new CommentaryError("wrong_job", "This is not a board-actions job.");
  if (job.state === "commentary_queued") return;
  const companyId = job.company_id;
  // Everything that stops the input being built stops it *after* the credits are held, so the
  // hold goes back now rather than at the sweeper.
  const payload = await releasingOnLayoutFault(
    pool,
    { accountId: input.accountId, jobId: job.id },
    (error) => error instanceof CommentaryError,
    () =>
      boardActionsInputFor(pool, wrapper, {
        accountId: input.accountId,
        companyId,
        period: input.period,
      }),
  );
  await saveStageOutput(pool, wrapper, {
    accountId: input.accountId,
    companyId,
    jobId: job.id,
    stage: INPUT_STAGE,
    output: payload,
  });
  await withTransaction(pool, async (tx) =>
    transition(tx, await lockJob(tx, job.id, input.accountId), "commentary_queued", {
      checkpoint: { period: input.period },
    }),
  );
}

/** Generate now, in the request. */
export async function runBoardActions(
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
    throw new CommentaryError("wrong_job", "This is not a board-actions job.");
  const scope = { accountId: input.accountId, companyId: job.company_id, jobId: job.id };
  const payload = (await loadStageOutput(pool, wrapper, {
    ...scope,
    stage: INPUT_STAGE,
  })) as BoardActionsInput | null;
  if (payload === null)
    throw new CommentaryError("wrong_job", "This job has not been queued.");

  try {
    const ctx = await jobAiContext(pool, transport, job.id);
    const outcome = await runJobAiStage(ctx, (c) => suggestBoardActions(c, payload), now);
    if (outcome.status === "paused") return "paused";
    await saveStageOutput(pool, wrapper, {
      ...scope,
      stage: OUTPUT_STAGE,
      output: outcome.value.output,
    });
    await completeCommentaryJob(pool, {
      accountId: input.accountId,
      jobId: job.id,
      now,
    });
    return "completed";
  } catch (error) {
    await failJob(pool, {
      accountId: input.accountId,
      jobId: job.id,
      failureClass: "platform_fault",
      code: "board_actions_failed",
      detail: "The suggestions could not be written. No credits were charged.",
      reportedBy: "server",
      now,
    });
    if (
      error instanceof Error &&
      (error.name === "AiStageError" || error.name === "RoutingError")
    )
      return "failed";
    throw error;
  }
}

/** What a completed job produced, with the facts its placeholders resolve against. */
export async function boardActionsForJob(
  pool: Pool,
  wrapper: KeyWrapper,
  input: { accountId: string; jobId: string },
): Promise<{ output: BoardActionsOutput; input: BoardActionsInput } | null> {
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
  })) as BoardActionsOutput | null;
  const payload = (await loadStageOutput(pool, wrapper, {
    ...scope,
    stage: INPUT_STAGE,
  })) as BoardActionsInput | null;
  return output === null || payload === null ? null : { output, input: payload };
}
