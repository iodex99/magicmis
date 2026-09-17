import {
  acceptJobQuote,
  cancelJob,
  completeDashboardAddon,
  confirmJob,
  heartbeatJob,
} from "@magicmis/jobs";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, idempotent, ok, withAccount } from "@/lib/http";
import { jobErrorResponse } from "@/lib/server/job-errors";
import { keyWrapper } from "@/lib/server/runtime";

type Ctx = { params: Promise<{ id: string; action: string }> };

/**
 * POST /api/jobs/:id/{confirm|accept-quote|deliver-dashboard|heartbeat|cancel}. Every transition is
 * checked on the server; the browser cannot choose a price, a charge, or a backwards move. Since
 * jobs run on the server (ADR 0032) the browser no longer advances or fails a job at all.
 */
export async function POST(request: Request, context: Ctx): Promise<Response> {
  return withAccount(async (account) => {
    const { id, action } = await context.params;
    if (!z.uuid().safeParse(id).success)
      return apiError(404, "job_not_found", "Job not found.");
    const pool = db();
    const base = { accountId: account.accountId, jobId: id };
    try {
      switch (action) {
        case "confirm":
          return await idempotent(
            request,
            `job-confirm:${account.accountId}:${id}`,
            { id },
            async () => ({
              status: 200,
              body: await confirmJob(pool, base),
            }),
          );
        case "accept-quote":
          return await idempotent(
            request,
            `job-quote:${account.accountId}:${id}`,
            { id },
            async () => ({
              status: 200,
              body: await acceptJobQuote(pool, base),
            }),
          );
        case "deliver-dashboard":
          return await idempotent(
            request,
            `job-dashboard:${account.accountId}:${id}`,
            { id },
            async () => {
              const r = await completeDashboardAddon(pool, keyWrapper(), base);
              return {
                status: 200,
                body: {
                  capturedCredits: r.captured.toString(),
                  blueprintVersion: r.blueprintVersion,
                },
              };
            },
          );
        case "heartbeat":
          return ok({ held: await heartbeatJob(pool, base) });
        case "cancel":
          return await idempotent(
            request,
            `job-cancel:${account.accountId}:${id}`,
            { id },
            async () => {
              const r = await cancelJob(pool, base);
              return { status: 200, body: { capturedCredits: r.captured.toString() } };
            },
          );
        default:
          return apiError(404, "not_found", "Unknown job action.");
      }
    } catch (error) {
      return jobErrorResponse(error);
    }
  });
}
