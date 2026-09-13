import { submitStepResult } from "@magicmis/chat/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, idempotent, withAccount } from "@/lib/http";
import { aiTransport } from "@/lib/server/ai";
import { progressBody } from "@/lib/server/chat";
import { jobErrorResponse } from "@/lib/server/job-errors";
import { keyWrapper } from "@/lib/server/runtime";

type Ctx = { params: Promise<{ id: string; stepId: string }> };

/**
 * POST /api/chat/messages/:id/steps/:stepId/result — the browser's redacted, capped result for a
 * Deep query. The server validates size, schema and redaction, then continues the loop (SPEC §27).
 */
export async function POST(request: Request, context: Ctx): Promise<Response> {
  return withAccount(async (account) => {
    const { id, stepId } = await context.params;
    if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(stepId).success)
      return apiError(404, "not_found", "Message not found.");
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return apiError(400, "invalid_json", "The request body is not valid JSON.");
    }
    try {
      return await idempotent(request, `chat-step:${stepId}`, raw, async () => ({
        status: 200,
        body: progressBody(
          await submitStepResult(db(), keyWrapper(), aiTransport(), {
            accountId: account.accountId,
            messageId: id,
            stepId,
            result: raw,
          }),
        ),
      }));
    } catch (error) {
      return jobErrorResponse(error);
    }
  });
}
