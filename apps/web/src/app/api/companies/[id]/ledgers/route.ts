import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, idempotent, parseJson, withAccount } from "@/lib/http";
import { LedgerMapError, setLedgerHead } from "@/lib/server/ledger-map";
import { keyWrapper } from "@/lib/server/runtime";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  ledgerKey: z.string().min(1).max(2000),
  /** A head code, or UNMAPPED to leave the ledger off the MIS for good. */
  head: z.string().min(1).max(40),
  /** The map version the change was made from: a newer one refuses it rather than undo it. */
  basedOn: z.number().int().positive(),
});

const STATUS: Record<LedgerMapError["code"], number> = {
  not_set_up: 409,
  unknown_ledger: 422,
  unknown_head: 422,
  busy: 409,
  stale: 409,
};

/**
 * PATCH /api/companies/:id/ledgers — put one ledger on another MIS line (ADR 0086).
 *
 * The company's own judgement about its own books: no model, no charge, and it reaches the
 * figures the next time the MIS is built. Ownership is checked before anything else, so another
 * account's company is not found, the same as one that does not exist.
 */
export async function PATCH(request: Request, context: Ctx): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      return apiError(404, "company_not_found", "Company not found.");
    const pool = db();
    const owned = await pool.query(
      `select 1 from companies where id = $1 and account_id = $2 and deleted_at is null`,
      [id, account.accountId],
    );
    if (owned.rowCount === 0)
      return apiError(404, "company_not_found", "Company not found.");
    const parsed = await parseJson(request, bodySchema);
    if (!parsed.ok) return parsed.response;
    return idempotent(
      request,
      `ledger-map:${account.accountId}:${id}`,
      parsed.raw,
      async () => {
        try {
          const version = await setLedgerHead(pool, keyWrapper(), {
            accountId: account.accountId,
            companyId: id,
            ...parsed.data,
          });
          return { status: 200, body: { version } };
        } catch (error) {
          if (error instanceof LedgerMapError)
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
