import {
  createShare,
  listShares,
  revokeShare,
  ShareError,
  shareLimits,
} from "@magicmis/jobs";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, idempotent, ok, parseJson, withAccount } from "@/lib/http";
import { keyWrapper } from "@/lib/server/runtime";
import { buildSharedBoard } from "@/lib/server/shares";

type Ctx = { params: Promise<{ id: string }> };

const createSchema = z
  .object({
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u),
    withWriting: z.boolean(),
    days: z.number().int().min(1).max(3650),
  })
  .strict();
const revokeSchema = z.object({ id: z.uuid() }).strict();

const STATUS: Record<ShareError["code"], number> = {
  not_found: 404,
  bad_period: 422,
  bad_days: 422,
};

const iso = (d: Date | null) => (d === null ? null : d.toISOString());

/** The company is this account's, and live: anything else is a 404, never an empty answer. */
async function owned(accountId: string, companyId: string): Promise<boolean> {
  if (!z.uuid().safeParse(companyId).success) return false;
  const r = await db().query(
    `select 1 from public.companies
      where id = $1 and account_id = $2 and deleted_at is null and purged_at is null`,
    [companyId, accountId],
  );
  return r.rowCount !== 0;
}

/** GET /api/companies/:id/shares — the company's links, how often each was opened (ADR 0090). */
export async function GET(_request: Request, context: Ctx): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!(await owned(account.accountId, id)))
      return apiError(404, "company_not_found", "Company not found.");
    const [shares, limits] = await Promise.all([
      listShares(db(), { accountId: account.accountId, companyId: id }),
      shareLimits(db()),
    ]);
    return ok({
      limits,
      shares: shares.map((s) => ({
        id: s.id,
        period: s.period,
        withWriting: s.withWriting,
        createdAt: iso(s.createdAt),
        expiresAt: iso(s.expiresAt),
        revokedAt: iso(s.revokedAt),
        views: s.views,
        lastViewedAt: iso(s.lastViewedAt),
      })),
    });
  });
}

/**
 * POST /api/companies/:id/shares — a link to the board as it is now (ADR 0090).
 *
 * It creates a row, so it takes an idempotency key (ADR 0059), and its answer holds the link's
 * secret, which must never be kept: the response is marked as holding one, so a retry is told the
 * link was made rather than shown it again, and the owner makes another. Nothing is charged: the
 * board shows what the owner already paid for.
 */
export async function POST(request: Request, context: Ctx): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!(await owned(account.accountId, id)))
      return apiError(404, "company_not_found", "Company not found.");
    const parsed = await parseJson(request, createSchema);
    if (!parsed.ok) return parsed.response;
    return idempotent(
      request,
      `share:${account.accountId}:${id}`,
      parsed.raw,
      async () => {
        const scope = { accountId: account.accountId, companyId: id };
        const now = new Date();
        const board = await buildSharedBoard(db(), scope, { ...parsed.data, now });
        if (board === null)
          return {
            status: 422,
            body: {
              error: "no_board",
              message: "That month is not on the board, so there is nothing to share.",
            },
          };
        try {
          const made = await createShare(db(), keyWrapper(), scope, {
            ...parsed.data,
            board,
            now,
          });
          return {
            status: 200,
            containsSecret: true,
            body: {
              id: made.id,
              path: `/s/${made.token}`,
              expiresAt: iso(made.expiresAt),
            },
          };
        } catch (error) {
          if (error instanceof ShareError)
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

/** DELETE /api/companies/:id/shares — withdraws a link at once; a second withdrawal is a no-op. */
export async function DELETE(request: Request, context: Ctx): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!(await owned(account.accountId, id)))
      return apiError(404, "company_not_found", "Company not found.");
    const parsed = await parseJson(request, revokeSchema);
    if (!parsed.ok) return parsed.response;
    try {
      await revokeShare(
        db(),
        { accountId: account.accountId, companyId: id },
        parsed.data.id,
      );
      return ok({ revoked: true });
    } catch (error) {
      if (error instanceof ShareError)
        return apiError(STATUS[error.code], error.code, error.message);
      throw error;
    }
  });
}
