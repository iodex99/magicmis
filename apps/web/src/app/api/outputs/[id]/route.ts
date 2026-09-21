import { openForCompany } from "@magicmis/engine/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, withAccount } from "@/lib/http";
import { jobErrorResponse } from "@/lib/server/job-errors";
import { rateLimited } from "@/lib/server/ratelimit";
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
    // A workbook holds every figure the raw file does, so it gets the same bucket the raw file
    // does (ADR 0057). A session that leaked could otherwise pull every workbook of every
    // company as fast as the network allowed.
    const limited = await rateLimited("download_per_account", account.accountId);
    if (limited !== null) return limited;
    const pool = db();
    const r = await pool.query<{
      company_id: string;
      storage_path: string;
      file_name: string | null;
      expires_at: Date | null;
      job_state: string | null;
    }>(
      `select o.company_id, o.storage_path, o.file_name, o.expires_at, j.state as job_state
         from outputs o left join jobs j on j.id = o.job_id
        where o.id = $1 and o.account_id = $2`,
      [id, account.accountId],
    );
    const row = r.rows[0];
    if (row === undefined || row.storage_path === "")
      return apiError(404, "output_not_found", "File not found.");
    // The row is written before the credits are captured, and the two are not one transaction.
    // A job that did not reach `completed` was not paid for, so its workbook is not deliverable
    // — the same rule `commentaryForJob` has always applied (ADR 0057).
    if (row.job_state !== null && row.job_state !== "completed")
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
