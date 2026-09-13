import { restoreCompany } from "@magicmis/jobs";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, idempotent, withAccount } from "@/lib/http";

/** POST /api/companies/:id/restore — restore price plus the current month's fee (SPEC §28). */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      return apiError(404, "company_not_found", "Company not found.");
    return idempotent(request, `restore:${account.accountId}:${id}`, { id }, async () => {
      const r = await restoreCompany(db(), {
        accountId: account.accountId,
        companyId: id,
      });
      if (r.status === "not_found")
        return {
          status: 404,
          body: { error: "company_not_found", message: "Company not found." },
        };
      if (r.status === "not_archived")
        return {
          status: 409,
          body: { error: "not_archived", message: "This company is not archived." },
        };
      if (r.status === "insufficient_credits") {
        return {
          status: 402,
          body: {
            error: "insufficient_credits",
            message: "Not enough credits to restore this company.",
            credits: r.credits.toString(),
          },
        };
      }
      return { status: 200, body: { restored: true, credits: r.credits.toString() } };
    }).catch(() =>
      apiError(500, "restore_failed", "The company could not be restored. Try again."),
    );
  });
}
