import { cancelJob, claimRun, releaseRun } from "@magicmis/jobs";

import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, ok, withAccount } from "@/lib/http";
import { jobErrorResponse } from "@/lib/server/job-errors";
import { rateLimited } from "@/lib/server/ratelimit";
import { runJobOnServer, yearQuestionOf } from "@/lib/server/run-job";

// A thirteen-month setup reads, maps, computes and renders in one request.
export const maxDuration = 300;

/**
 * POST /api/jobs/:id/run — run a reserved setup or refresh on the server, start to finish
 * (ADR 0032). The browser calls this once after the SPEC §12 confirmation and shows progress by
 * polling GET /api/jobs/:id; the response is the outcome: the workbook, its checks and anything
 * that went differently from plan.
 *
 * It is called once more for a run that stopped on the year question (ADR 0086), with the credits
 * still held: after the owner has changed the company's year through its settings, or with
 * `keepYear` to build on the company's own year anyway. Neither charges again.
 */
const bodySchema = z.object({ keepYear: z.boolean().optional() }).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withAccount(async (account) => {
    const limited = await rateLimited("ai_per_account", account.accountId);
    if (limited !== null) return limited;
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      return apiError(404, "job_not_found", "Job not found.");
    const pool = db();
    const job = await pool.query<{
      state: string;
      type: string;
      tier: string;
      stage_checkpoints: Record<string, unknown>;
    }>(
      `select state, type, tier, stage_checkpoints from jobs where id = $1 and account_id = $2`,
      [id, account.accountId],
    );
    const row = job.rows[0];
    if (row === undefined) return apiError(404, "job_not_found", "Job not found.");
    // `refresh_with_restructure` belongs here: `createJob` silently upgrades a refresh to it
    // whenever the files drift past the threshold, prices it higher, and `confirm` holds that
    // price — so leaving it out held 599 credits for a job that could never be run, and every
    // press of the button held another lot (ADR 0057).
    if (
      ![
        "company_setup",
        "monthly_refresh",
        "refresh_with_restructure",
        "reference_mis_recreate",
      ].includes(row.type)
    ) {
      // Whatever is refused here was confirmed, so its credits are held. Nothing has run, so
      // cancelling releases them in full rather than leaving them for the sweeper two hours on.
      await cancelJob(pool, { accountId: account.accountId, jobId: id }).catch(
        () => undefined,
      );
      return apiError(409, "wrong_job", "This job does not run from uploaded files.");
    }
    const body = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success)
      return apiError(400, "invalid_request", "That is not a valid request.");
    const question = yearQuestionOf(row.stage_checkpoints);
    const waiting = row.state === "awaiting_review" && question !== null;
    if (row.state !== "reserved" && !waiting)
      return apiError(
        409,
        "invalid_transition",
        "This job has already started. Reload the page to see its progress.",
      );
    // One run per job at a time (ADR 0091): a second press while this one works is refused.
    const scope = { accountId: account.accountId, jobId: id };
    if (
      !(await claimRun(pool, {
        ...scope,
        state: row.state,
        leaseSeconds: maxDuration + 60,
      }))
    )
      return apiError(
        409,
        "invalid_transition",
        "This job is already running. Its progress shows on the page — there is no need to press it again.",
      );
    // "Keep the company's year" is this job's answer only: the next run asks again.
    if (waiting && body.data.keepYear === true)
      await pool.query(
        `update jobs set stage_checkpoints = stage_checkpoints || jsonb_build_object('year_kept', $2::int)
          where id = $1 and account_id = $3`,
        [id, question.files, account.accountId],
      );
    try {
      const outcome = await runJobOnServer(pool, {
        accountId: account.accountId,
        jobId: id,
        tier: row.tier as "efficient" | "professional" | "expert",
      });
      return ok(outcome);
    } catch (error) {
      return jobErrorResponse(error);
    } finally {
      await releaseRun(pool, scope).catch(() => undefined);
    }
  });
}
