import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, ok, withAccount } from "@/lib/http";
import { jobSession } from "@/lib/server/companies";
import { jobErrorResponse } from "@/lib/server/job-errors";

/**
 * GET /api/companies/:id/session — what the browser pipeline needs for this company: its
 * redaction key, mapping library, validation config, and the company's own memory (mapping rules,
 * prior balances), decrypted for the owner (SPEC §17, §20). Never cached.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      return apiError(404, "company_not_found", "Company not found.");
    try {
      const session = await jobSession(db(), account.accountId, id);
      if (session === null)
        return apiError(404, "company_not_found", "Company not found.");
      return ok(session);
    } catch (error) {
      return jobErrorResponse(error);
    }
  });
}
