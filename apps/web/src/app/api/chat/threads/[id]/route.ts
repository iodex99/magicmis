import { threadView } from "@magicmis/chat/server";
import { readConfig } from "@magicmis/db/config";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, ok, withAccount } from "@/lib/http";
import { jobErrorResponse } from "@/lib/server/job-errors";
import { keyWrapper } from "@/lib/server/runtime";

/** GET /api/chat/threads/:id — messages with answers, the values they cite and query lineage. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return apiError(404, "not_found", "Conversation not found.");
    try {
      const pool = db();
      const view = await threadView(pool, keyWrapper(), { accountId: account.accountId, threadId: id });
      if (view === null) return apiError(404, "not_found", "Conversation not found.");
      return ok({
        ...view,
        allowlist: await readConfig(pool, "commentary.digit_allowlist", z.array(z.string())),
      });
    } catch (error) {
      return jobErrorResponse(error);
    }
  });
}
