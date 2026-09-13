import { undoTemplatePatch } from "@magicmis/jobs";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, idempotent, parseJson, withAccount } from "@/lib/http";
import { jobErrorResponse } from "@/lib/server/job-errors";
import { keyWrapper } from "@/lib/server/runtime";

const bodySchema = z.object({
  action: z.literal("undo"),
  baseVersion: z.number().int().positive(),
});

/** POST /api/companies/:id/template {action: "undo"} — restores the MIS layout before a chat edit. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      return apiError(404, "company_not_found", "Company not found.");
    const parsed = await parseJson(request, bodySchema);
    if (!parsed.ok) return parsed.response;
    try {
      return await idempotent(
        request,
        `template-undo:${account.accountId}:${id}`,
        parsed.raw,
        async () => {
          const r = await undoTemplatePatch(db(), keyWrapper(), {
            accountId: account.accountId,
            companyId: id,
            baseVersion: parsed.data.baseVersion,
          });
          return {
            status: 200,
            body: { blueprintVersion: r.blueprintVersion, canUndo: r.canUndo },
          };
        },
      );
    } catch (error) {
      return jobErrorResponse(error);
    }
  });
}
