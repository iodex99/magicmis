import {
  acceptJobQuote,
  advanceJob,
  cancelJob,
  completeDashboardAddon,
  confirmJob,
  failJob,
  heartbeatJob,
} from "@magicmis/jobs";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, idempotent, ok, parseJson, withAccount } from "@/lib/http";
import { jobErrorResponse } from "@/lib/server/job-errors";
import { keyWrapper } from "@/lib/server/runtime";

type Ctx = { params: Promise<{ id: string; action: string }> };

const advanceSchema = z.object({
  to: z.enum([
    "preflight",
    "profiling",
    "classifying",
    "mapping",
    "awaiting_review",
    "computing",
    "validating",
    "rendering",
  ]),
});

const failSchema = z.object({
  failureClass: z.enum(["data_fault", "platform_fault"]),
  code: z.string().regex(/^[A-Za-z0-9_]{1,40}$/u),
  // Plain explanation and fix, no figures (SPEC §21 results carry aggregates only).
  detail: z.string().max(2000),
});

/**
 * POST /api/jobs/:id/{confirm|accept-quote|advance|deliver-dashboard|heartbeat|cancel|fail}. Every transition is
 * checked on the server; the browser cannot choose a price, a charge, or a backwards move.
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
          return await idempotent(request, `job-confirm:${account.accountId}:${id}`, { id }, async () => ({
            status: 200,
            body: await confirmJob(pool, base),
          }));
        case "accept-quote":
          return await idempotent(request, `job-quote:${account.accountId}:${id}`, { id }, async () => ({
            status: 200,
            body: await acceptJobQuote(pool, base),
          }));
        case "advance": {
          const parsed = await parseJson(request, advanceSchema);
          if (!parsed.ok) return parsed.response;
          await advanceJob(pool, { ...base, to: parsed.data.to });
          return ok({ state: parsed.data.to });
        }
        case "deliver-dashboard":
          return await idempotent(request, `job-dashboard:${account.accountId}:${id}`, { id }, async () => {
            const r = await completeDashboardAddon(pool, keyWrapper(), base);
            return {
              status: 200,
              body: {
                capturedCredits: r.captured.toString(),
                blueprintVersion: r.blueprintVersion,
              },
            };
          });
        case "heartbeat":
          return ok({ held: await heartbeatJob(pool, base) });
        case "cancel":
          return await idempotent(request, `job-cancel:${account.accountId}:${id}`, { id }, async () => {
            const r = await cancelJob(pool, base);
            return { status: 200, body: { capturedCredits: r.captured.toString() } };
          });
        case "fail": {
          const parsed = await parseJson(request, failSchema);
          if (!parsed.ok) return parsed.response;
          const r = await failJob(pool, {
            ...base,
            ...parsed.data,
            reportedBy: "browser",
          });
          return ok({ state: r.state, capturedCredits: r.captured.toString() });
        }
        default:
          return apiError(404, "not_found", "Unknown job action.");
      }
    } catch (error) {
      return jobErrorResponse(error);
    }
  });
}
