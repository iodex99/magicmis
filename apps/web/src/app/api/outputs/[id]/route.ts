import { openForCompany } from "@magicmis/engine/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, withAccount } from "@/lib/http";
import { jobErrorResponse } from "@/lib/server/job-errors";
import { keyWrapper, outputStore } from "@/lib/server/runtime";

/** GET /api/outputs/:id — the owner's workbook, decrypted on the way out (SPEC §24.1). */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      return apiError(404, "output_not_found", "File not found.");
    const pool = db();
    const r = await pool.query<{
      company_id: string;
      storage_path: string;
      file_name: string | null;
      expires_at: Date | null;
    }>(
      `select company_id, storage_path, file_name, expires_at from outputs where id = $1 and account_id = $2`,
      [id, account.accountId],
    );
    const row = r.rows[0];
    if (row === undefined || row.storage_path === "")
      return apiError(404, "output_not_found", "File not found.");
    if (row.expires_at !== null && row.expires_at < new Date())
      return apiError(410, "output_expired", "This file is past its retention period.");
    try {
      const sealed = await (await outputStore()).get(row.storage_path);
      const bytes = await openForCompany(pool, keyWrapper(), {
        accountId: account.accountId,
        companyId: row.company_id,
        purpose: "output",
        id,
        sealed,
      });
      const name = (row.file_name ?? "mis.xlsx").replace(/[^A-Za-z0-9_.-]/gu, "_");
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
          "content-type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": `attachment; filename="${name}"`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      });
    } catch (error) {
      return jobErrorResponse(error);
    }
  });
}
