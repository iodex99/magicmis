import { ExportUnavailable, openAccountExport } from "@magicmis/jobs";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, withAccount } from "@/lib/http";
import { rateLimited } from "@/lib/server/ratelimit";
import { keyWrapper, outputStore } from "@/lib/server/runtime";

/** GET /api/account/export/:id — the owner's export, decrypted on the way out while the link is live. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      return apiError(404, "export_not_found", "Export not found.");
    const limited = await rateLimited("export_per_account", account.accountId);
    if (limited !== null) return limited;
    try {
      const bytes = await openAccountExport(db(), keyWrapper(), await outputStore(), {
        accountId: account.accountId,
        exportId: id,
      });
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="account-export-${id}.json"`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      });
    } catch (error) {
      if (!(error instanceof ExportUnavailable)) throw error;
      if (error.reason === "expired")
        return apiError(
          410,
          "export_expired",
          "This download link has expired. Request a new export.",
        );
      if (error.reason === "not_ready")
        return apiError(
          409,
          "export_not_ready",
          "This export is still being prepared. We will email you when it is ready.",
        );
      return apiError(404, "export_not_found", "Export not found.");
    }
  });
}
