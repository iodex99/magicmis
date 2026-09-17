import { storeChunk, uploadLimits } from "@magicmis/jobs";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, ok, withAccount } from "@/lib/http";
import { keyWrapper, outputStore } from "@/lib/server/runtime";
import { readBinaryBody, uploadErrorResponse } from "@/lib/server/uploads";

/**
 * PUT /api/uploads/:id/chunks/:index — one part of a file, as raw bytes (ADR 0032). It is sealed
 * under the company's data key before it is stored; the store never holds plaintext.
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string; index: string }> },
): Promise<Response> {
  return withAccount(async (account) => {
    const { id, index } = await context.params;
    if (!z.uuid().safeParse(id).success || !/^\d{1,5}$/u.test(index))
      return apiError(404, "upload_not_found", "Upload not found.");
    const pool = db();
    const { chunkBytes } = await uploadLimits(pool);
    const body = await readBinaryBody(request, chunkBytes);
    if (!body.ok) return body.response;
    try {
      const stored = await storeChunk(pool, keyWrapper(), await outputStore(), {
        accountId: account.accountId,
        uploadId: id,
        index: Number.parseInt(index, 10),
        bytes: body.bytes,
      });
      return ok(stored);
    } catch (error) {
      const response = uploadErrorResponse(error);
      if (response !== null) return response;
      throw error;
    }
  });
}
