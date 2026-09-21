import { createUpload } from "@magicmis/jobs";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, idempotent, parseJson, withAccount } from "@/lib/http";
import { processingConsentRequired } from "@/lib/server/consent";
import { uploadErrorResponse } from "@/lib/server/uploads";

const bodySchema = z.object({
  fileName: z.string().min(1).max(255),
  byteSize: z.number().int().positive(),
});

/**
 * POST /api/companies/:id/uploads — start uploading one file (ADR 0032). Returns the upload id,
 * the chunk size and how many chunks to send. Nothing is read from the file until it is complete.
 *
 * Idempotent, like every other route that creates something (ADR 0059). A retried request used to
 * make a **second** upload row for the same file, and `companyStorage` counts every row that is
 * not deleted at the size the browser declared — so a dropped connection on this one call cost the
 * company that file's worth of its cap twice, with only one of them on the file list.
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
    return idempotent(
      request,
      `upload-create:${account.accountId}:${id}`,
      parsed.raw,
      async () => {
        try {
          const created = await createUpload(db(), {
            accountId: account.accountId,
            companyId: id,
            fileName: parsed.data.fileName,
            byteSize: parsed.data.byteSize,
          });
          return { status: 201, body: created };
        } catch (error) {
          const response = uploadErrorResponse(error);
          if (response !== null) return response;
          throw error;
        }
      },
    );
  });
}
