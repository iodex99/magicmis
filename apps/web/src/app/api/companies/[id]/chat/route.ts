import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, ok, withAccount } from "@/lib/http";

/** GET /api/companies/:id/chat — the company's conversations, newest first. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      return apiError(404, "company_not_found", "Company not found.");
    // Another account's company is "not found", exactly like one that does not exist.
    const owned = await db().query(
      `select 1 from companies where id = $1 and account_id = $2 and deleted_at is null`,
      [id, account.accountId],
    );
    if (owned.rows.length === 0)
      return apiError(404, "company_not_found", "Company not found.");
    const r = await db().query<{
      id: string;
      status: string;
      message_count: number;
      created_at: Date;
    }>(
      `select id, status, message_count, created_at from chat_threads
       where company_id = $1 and account_id = $2 order by created_at desc limit 50`,
      [id, account.accountId],
    );
    return ok({
      threads: r.rows.map((t) => ({
        id: t.id,
        status: t.status,
        messageCount: t.message_count,
        createdAt: t.created_at.toISOString(),
      })),
    });
  });
}
