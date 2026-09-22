import { parsePeriodId } from "@magicmis/core/time";
import { queueBoardActions, runBoardActions } from "@magicmis/jobs";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, idempotent, ok, parseJson, withAccount } from "@/lib/http";
import { aiTransport } from "@/lib/server/ai";
import { boardActionsPayload } from "@/lib/server/insights";
import { jobErrorResponse } from "@/lib/server/job-errors";
import { rateLimited } from "@/lib/server/ratelimit";
import { keyWrapper } from "@/lib/server/runtime";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/u) });

/**
 * POST /api/jobs/:id/board-actions {period} — after the price is confirmed, the server builds the
 * facts pack from the stored snapshot and writes the suggestions in this request (ADR 0062).
 *
 * The browser sends a month, never text: the only free-text input to the model in this product is
 * a chat message, and this is not one.
 */
export async function POST(request: Request, context: Ctx): Promise<Response> {
  return withAccount(async (account) => {
    // This calls the model in the request, so it takes the AI bucket (SPEC §30).
    const limited = await rateLimited("ai_per_account", account.accountId);
    if (limited !== null) return limited;
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      return apiError(404, "job_not_found", "Job not found.");
    const parsed = await parseJson(request, bodySchema);
    if (!parsed.ok) return parsed.response;
    const period = parsePeriodId(parsed.data.period);
    if (period === null)
      return apiError(422, "validation_failed", "Choose a month.", {
        period: "Invalid month",
      });
    const pool = db();
    const base = { accountId: account.accountId, jobId: id };
    try {
      return await idempotent(
        request,
        `job-board-actions:${account.accountId}:${id}`,
        parsed.raw,
        async () => {
          await queueBoardActions(pool, keyWrapper(), { ...base, period });
          const state = await runBoardActions(pool, keyWrapper(), aiTransport(), base);
          return { status: 200, body: { state } };
        },
      );
    } catch (error) {
      return jobErrorResponse(error);
    }
  });
}

/** GET /api/jobs/:id/board-actions — the stored suggestions and the facts they resolve against. */
export async function GET(_request: Request, context: Ctx): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      return apiError(404, "job_not_found", "Job not found.");
    try {
      const payload = await boardActionsPayload(db(), account.accountId, id);
      return payload === null
        ? apiError(404, "board_actions_not_ready", "These suggestions are not ready yet.")
        : ok(payload);
    } catch (error) {
      return jobErrorResponse(error);
    }
  });
}
