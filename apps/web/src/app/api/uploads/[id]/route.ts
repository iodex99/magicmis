import { hasFreshReauth } from "@magicmis/accounts";
import {
  deleteUpload,
  getUpload,
  loadUploadBytes,
  setUploadOnDashboard,
} from "@magicmis/jobs";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, ok, parseJson, withAccount } from "@/lib/http";
import { rateLimited } from "@/lib/server/ratelimit";
import { keyWrapper, outputStore } from "@/lib/server/runtime";
import { uploadErrorResponse } from "@/lib/server/uploads";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => apiError(404, "upload_not_found", "Upload not found.");

async function guarded(work: () => Promise<Response>): Promise<Response> {
  try {
    return await work();
  } catch (error) {
    const response = uploadErrorResponse(error);
    if (response !== null) return response;
    throw error;
  }
}

/**
 * GET /api/uploads/:id — the owner's own file back, exactly as they uploaded it (ADR 0047).
 *
 * Files are kept so that their owner has them. This is the only way one leaves the store as a
 * file, it is scoped to the signed-in account by `getUpload`, and it is written to the file's
 * read log like every other decryption, where the owner sees it.
 *
 * **A session alone is not enough.** Raw client books are the most sensitive thing the service
 * holds, and before this route a borrowed or stolen session could not take one out. Like the
 * account data export (SPEC §8) it needs a fresh password confirmation, and it is rate limited
 * per account. `?check=1` answers whether a download would be allowed without decrypting
 * anything, so the page can ask for the password first and the read log only ever records real
 * downloads.
 */
export async function GET(request: Request, context: Ctx): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return notFound();
    if (!(await hasFreshReauth(db(), account)))
      return apiError(
        403,
        "reauth_required",
        "Confirm your password to download your files.",
      );
    if (new URL(request.url).searchParams.has("check")) {
      return guarded(async () => {
        await getUpload(db(), account.accountId, id);
        return ok({ allowed: true });
      });
    }
    const limited = await rateLimited("ai_per_account", account.accountId);
    if (limited !== null) return limited;
    return guarded(async () => {
      const { upload, bytes } = await loadUploadBytes(
        db(),
        keyWrapper(),
        await outputStore(),
        { accountId: account.accountId, uploadId: id, purpose: "download" },
      );
      // The name goes out percent-encoded only: a file name is the customer's text.
      const name = encodeURIComponent(upload.fileName);
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition": `attachment; filename*=UTF-8''${name}`,
          "content-length": bytes.length.toString(),
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      });
    });
  });
}

const patchSchema = z.object({ onDashboard: z.boolean() }).strict();

/**
 * PATCH /api/uploads/:id {onDashboard} — tick or untick a file for the dashboard (ADR 0047). A
 * view filter over figures already computed and paid for: nothing is read, computed or charged.
 * Setting a flag to a value is idempotent by nature.
 */
export async function PATCH(request: Request, context: Ctx): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return notFound();
    const parsed = await parseJson(request, patchSchema);
    if (!parsed.ok) return parsed.response;
    return guarded(async () => {
      await setUploadOnDashboard(db(), {
        accountId: account.accountId,
        uploadId: id,
        onDashboard: parsed.data.onDashboard,
      });
      return ok({ onDashboard: parsed.data.onDashboard });
    });
  });
}

/** DELETE /api/uploads/:id — remove an uploaded file and its stored chunks now (ADR 0032). */
export async function DELETE(_request: Request, context: Ctx): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return notFound();
    return guarded(async () => {
      await deleteUpload(db(), await outputStore(), {
        accountId: account.accountId,
        uploadId: id,
      });
      return ok({ deleted: true });
    });
  });
}
