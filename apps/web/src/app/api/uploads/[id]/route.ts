import { deleteUpload } from "@magicmis/jobs";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, ok, withAccount } from "@/lib/http";
import { outputStore } from "@/lib/server/runtime";
import { uploadErrorResponse } from "@/lib/server/uploads";

/** DELETE /api/uploads/:id — remove an uploaded file and its stored chunks now (ADR 0032). */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      return apiError(404, "upload_not_found", "Upload not found.");
    try {
      await deleteUpload(db(), await outputStore(), {
        accountId: account.accountId,
        uploadId: id,
      });
      return ok({ deleted: true });
    } catch (error) {
      const response = uploadErrorResponse(error);
      if (response !== null) return response;
      throw error;
    }
  });
}
