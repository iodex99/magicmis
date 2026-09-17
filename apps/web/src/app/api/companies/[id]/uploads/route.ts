import { createUpload } from "@magicmis/jobs";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, ok, parseJson, withAccount } from "@/lib/http";
import { processingConsentRequired } from "@/lib/server/consent";
import { uploadErrorResponse } from "@/lib/server/uploads";

const bodySchema = z.object({
  fileName: z.string().min(1).max(255),
  byteSize: z.number().int().positive(),
});

/**
 * POST /api/companies/:id/uploads — start uploading one file (ADR 0032). Returns the upload id,
 * the chunk size and how many chunks to send. Nothing is read from the file until it is complete.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withAccount(async (account) => {
    const consent = await processingConsentRequired(account.accountId);
    if (consent !== null) return consent;
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      return apiError(404, "company_not_found", "Company not found.");
    const parsed = await parseJson(request, bodySchema);
    if (!parsed.ok) return parsed.response;
    try {
      const created = await createUpload(db(), {
        accountId: account.accountId,
        companyId: id,
        fileName: parsed.data.fileName,
        byteSize: parsed.data.byteSize,
      });
      return ok(created, 201);
    } catch (error) {
      const response = uploadErrorResponse(error);
      if (response !== null) return response;
      throw error;
    }
  });
}
