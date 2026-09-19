import { countSourceFile, SOURCE_REFUSAL_MESSAGES } from "@magicmis/ingest";
import { finishUpload, loadUploadBytes, uploadLimits } from "@magicmis/jobs";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, ok, withAccount } from "@/lib/http";
import { keyWrapper, outputStore } from "@/lib/server/runtime";
import { uploadErrorResponse } from "@/lib/server/uploads";

export const maxDuration = 120;

/**
 * POST /api/uploads/:id/complete — the last chunk has arrived; read the file (ADR 0032).
 *
 * Returns what SPEC §2.3 allows before payment: the name, size, sheet count and row count — or,
 * for a file that cannot be read, why and what to export instead. Recognition waits for the paid
 * run.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      return apiError(404, "upload_not_found", "Upload not found.");
    const pool = db();
    try {
      const { upload, bytes } = await loadUploadBytes(
        pool,
        keyWrapper(),
        await outputStore(),
        {
          accountId: account.accountId,
          uploadId: id,
          // Counted once on arrival, for the name, size, sheet and row counts shown before payment.
          purpose: "intake",
        },
      );
      const limits = await uploadLimits(pool);
      // Counts only before payment (SPEC §2.3): a workbook is counted without building cells.
      const read = await countSourceFile(upload.fileName, new Uint8Array(bytes), {
        maxEntries: 10_000,
        maxUncompressedBytes: limits.maxFileBytes * 20,
        maxRatio: 200,
      });
      if (!read.ok) {
        const message = SOURCE_REFUSAL_MESSAGES[read.reason];
        await finishUpload(pool, {
          accountId: account.accountId,
          uploadId: id,
          outcome: { status: "refused", refusal: message },
        });
        return ok({
          uploadId: id,
          name: upload.fileName,
          size: upload.byteSize,
          refused: message,
        });
      }
      const { rows } = read;
      await finishUpload(pool, {
        accountId: account.accountId,
        uploadId: id,
        outcome: { status: "ready", sheets: read.sheets, rows },
      });
      return ok({
        uploadId: id,
        name: upload.fileName,
        size: upload.byteSize,
        sheets: read.sheets,
        rows,
        refused: null,
      });
    } catch (error) {
      const response = uploadErrorResponse(error);
      if (response !== null) return response;
      throw error;
    }
  });
}
