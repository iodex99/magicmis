import { restoreCompany } from "@magicmis/jobs";

import { db } from "@/lib/db";
import { apiError, idempotent, withAccount } from "@/lib/http";

/** POST /api/companies/:id/restore — restore price plus the current month's fee (SPEC §28). */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    return idempotent(request, `restore:${account.accountId}:${id}`, { id }, async () => {
      const r = await restoreCompany(db(), {
        accountId: account.accountId,
        companyId: id,
      });
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
