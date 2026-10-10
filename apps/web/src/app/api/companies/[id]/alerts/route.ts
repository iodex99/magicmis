import { decimalStringToPaise } from "@magicmis/ingest";
import { addAlert, AlertError, removeAlert } from "@magicmis/jobs";
import { METRIC_CATALOG } from "@magicmis/templates";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, idempotent, ok, parseJson, withAccount } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

/** The figures an alert may watch: the ones a board may show (ADR 0087). */
const WATCHABLE = new Map(
  METRIC_CATALOG.filter((m) => m.onBoard !== false).map((m) => [m.id, m.unit]),
);

const addSchema = z
  .object({
    metricId: z.string().min(1).max(60),
    comparator: z.enum(["below", "above"]),
    /** As the owner typed it: whole currency units for money, a plain number otherwise. */
    value: z.string().regex(/^-?[0-9]{1,15}(\.[0-9]{1,6})?$/u),
  })
  .strict();
const removeSchema = z.object({ id: z.uuid() }).strict();

const STATUS: Record<AlertError["code"], number> = {
  unknown_metric: 422,
  bad_threshold: 422,
  too_many: 409,
  not_found: 404,
};

async function owned(accountId: string, companyId: string): Promise<boolean> {
  const r = await db().query(
    // A purged company is never deleted (the archive purge keeps the row), and nothing purges
    // it a second time: an alert added to one would outlive the account's erasure.
    `select 1 from companies
      where id = $1 and account_id = $2 and deleted_at is null and purged_at is null`,
    [companyId, accountId],
  );
  return r.rowCount !== 0;
}

/**
 * POST /api/companies/:id/alerts — an alert on one of the company's own figures (ADR 0087).
 * It creates a row, so it takes an idempotency key (ADR 0059). Nothing is charged: it watches
 * figures the company's runs already pay for, and checking it calls no model.
 */
export async function POST(request: Request, context: Ctx): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success || !(await owned(account.accountId, id)))
      return apiError(404, "company_not_found", "Company not found.");
    const parsed = await parseJson(request, addSchema);
    if (!parsed.ok) return parsed.response;
    return idempotent(
      request,
      `alert:${account.accountId}:${id}`,
      parsed.raw,
      async () => {
        const unit = WATCHABLE.get(parsed.data.metricId);
        // Money is kept in minor units, as the engine keeps it; everything else as typed.
        const threshold =
          unit === "money"
            ? decimalStringToPaise(parsed.data.value.replace(/^-/u, "")) *
              (parsed.data.value.startsWith("-") ? -1n : 1n)
            : parsed.data.value;
        try {
          const alert = await addAlert(
            db(),
            { accountId: account.accountId, companyId: id },
            {
              metricId: parsed.data.metricId,
              comparator: parsed.data.comparator,
              threshold: threshold.toString(),
              allowed: new Set(WATCHABLE.keys()),
            },
          );
          return { status: 200, body: { alert } };
        } catch (error) {
          if (error instanceof AlertError)
            return {
              status: STATUS[error.code],
              body: { error: error.code, message: error.message },
            };
          throw error;
        }
      },
    );
  });
}

/** DELETE /api/companies/:id/alerts — removes one of the company's alerts. */
export async function DELETE(request: Request, context: Ctx): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success || !(await owned(account.accountId, id)))
      return apiError(404, "company_not_found", "Company not found.");
    const parsed = await parseJson(request, removeSchema);
    if (!parsed.ok) return parsed.response;
    try {
      await removeAlert(
        db(),
        { accountId: account.accountId, companyId: id },
        parsed.data.id,
      );
      return ok({ removed: true });
    } catch (error) {
      if (error instanceof AlertError)
        return apiError(STATUS[error.code], error.code, error.message);
      throw error;
    }
  });
}
