import { anthropicTransport } from "@magicmis/ai";
import { parsePeriodId } from "@magicmis/core/time";
import { queueCommentary, runInstantCommentary } from "@magicmis/jobs";
import { z } from "zod";

import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { apiError, idempotent, ok, parseJson, withAccount } from "@/lib/http";
import { commentaryPayload } from "@/lib/server/insights";
import { jobErrorResponse } from "@/lib/server/job-errors";
import { keyWrapper } from "@/lib/server/runtime";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/u) });

/**
 * POST /api/jobs/:id/commentary {period} — after the price is confirmed, the server builds the facts
 * pack from the stored snapshot and queues the job (SPEC §25). Instant delivery generates in this
 * request; Standard goes to the next Message Batch. The browser sends a month, never text.
 */
export async function POST(request: Request, context: Ctx): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      return apiError(404, "job_not_found", "Job not found.");
    const parsed = await parseJson(request, bodySchema);
    if (!parsed.ok) return parsed.response;
    const period = parsePeriodId(parsed.data.period);
    if (period === null)
      return apiError(422, "validation_failed", "Choose a month.", { period: "Invalid month" });
    const pool = db();
    const base = { accountId: account.accountId, jobId: id };
    try {
      return await idempotent(request, `job-commentary:${id}`, parsed.raw, async () => {
        const { delivery } = await queueCommentary(pool, keyWrapper(), { ...base, period });
        if (delivery === "standard")
          return { status: 202, body: { state: "commentary_queued" } };
        const state = await runInstantCommentary(
          pool,
          keyWrapper(),
          anthropicTransport(serverEnv().ANTHROPIC_API_KEY),
          base,
        );
        return { status: 200, body: { state } };
      });
    } catch (error) {
      return jobErrorResponse(error);
    }
  });
}

/** GET /api/jobs/:id/commentary — the stored commentary, its facts pack and the values it refers to. */
export async function GET(_request: Request, context: Ctx): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      return apiError(404, "job_not_found", "Job not found.");
    try {
      const payload = await commentaryPayload(db(), account.accountId, id);
      return payload === null
        ? apiError(404, "commentary_not_ready", "This commentary is not ready yet.")
        : ok(payload);
    } catch (error) {
      return jobErrorResponse(error);
    }
  });
}
