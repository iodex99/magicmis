import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, ok, withAccount } from "@/lib/http";
import { jobErrorResponse } from "@/lib/server/job-errors";
import { rateLimited } from "@/lib/server/ratelimit";
import { runJobOnServer } from "@/lib/server/run-job";

// A thirteen-month setup reads, maps, computes and renders in one request.
export const maxDuration = 300;

/**
 * POST /api/jobs/:id/run — run a reserved setup or refresh on the server, start to finish
 * (ADR 0032). The browser calls this once after the SPEC §12 confirmation and shows progress by
 * polling GET /api/jobs/:id; the response is the outcome: the workbook, its checks and anything
 * that went differently from plan.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withAccount(async (account) => {
    const limited = await rateLimited("ai_per_account", account.accountId);
    if (limited !== null) return limited;
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      return apiError(404, "job_not_found", "Job not found.");
    const pool = db();
    const job = await pool.query<{ state: string; type: string; tier: string }>(
      `select state, type, tier from jobs where id = $1 and account_id = $2`,
      [id, account.accountId],
    );
    const row = job.rows[0];
    if (row === undefined) return apiError(404, "job_not_found", "Job not found.");
    if (
      !["company_setup", "monthly_refresh", "reference_mis_recreate"].includes(row.type)
    )
      return apiError(409, "wrong_job", "This job does not run from uploaded files.");
    if (row.state !== "reserved")
      return apiError(
        409,
        "invalid_transition",
        "This job has already started. Reload the page to see its progress.",
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
    }
  });
}
