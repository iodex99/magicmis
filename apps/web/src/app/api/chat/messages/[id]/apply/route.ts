import { threadView } from "@magicmis/chat/server";
import { applyDashboardPatch, applyTemplatePatch } from "@magicmis/jobs";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, idempotent, withAccount } from "@/lib/http";
import { jobErrorResponse } from "@/lib/server/job-errors";
import { keyWrapper } from "@/lib/server/runtime";

const bodySchema = z.object({ threadId: z.uuid() });

/**
 * POST /api/chat/messages/:id/apply {threadId} — applies the patch an Edit reply proposed, after
 * the user saw the preview. The operations come from the stored reply, never from the browser.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return apiError(404, "not_found", "Message not found.");
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return apiError(400, "invalid_json", "The request body is not valid JSON.");
    }
    const body = bodySchema.safeParse(raw);
    if (!body.success) return apiError(422, "validation_failed", "A conversation is required.");
    try {
      return await idempotent(request, `chat-apply:${id}`, raw, async () => {
        const pool = db();
        const view = await threadView(pool, keyWrapper(), {
          accountId: account.accountId,
          threadId: body.data.threadId,
        });
        const reply = view?.messages.find((m) => m.id === id)?.reply;
        if (view === null || reply?.kind !== "edit" || reply.scope !== "in_scope")
          return { status: 404, body: { error: "not_found", message: "There is no change to apply." } };
        const scope = { accountId: account.accountId, companyId: view.companyId };
        const input = { ...scope, baseVersion: reply.baseVersion, operations: reply.operations };
        const result =
          reply.target === "dashboard"
            ? await applyDashboardPatch(pool, keyWrapper(), input)
            : await applyTemplatePatch(pool, keyWrapper(), input);
        return {
          status: 200,
          body: { target: reply.target, blueprintVersion: result.blueprintVersion, canUndo: result.canUndo },
        };
      });
    } catch (error) {
      return jobErrorResponse(error);
    }
  });
}
