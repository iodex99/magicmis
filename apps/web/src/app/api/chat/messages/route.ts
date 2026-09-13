import { processMessage, sendMessage } from "@magicmis/chat/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { idempotent, parseJson, withAccount } from "@/lib/http";
import { processingConsentRequired } from "@/lib/server/consent";
import { rateLimited } from "@/lib/server/ratelimit";
import { aiTransport } from "@/lib/server/ai";
import { progressBody } from "@/lib/server/chat";
import { jobErrorResponse } from "@/lib/server/job-errors";
import { keyWrapper } from "@/lib/server/runtime";

const bodySchema = z.object({
  companyId: z.uuid(),
  threadId: z.uuid().nullable(),
  type: z.enum(["quick", "deep", "edit", "investigate"]),
  tier: z.enum(["efficient", "professional", "expert"]),
  // The only free text sent to the model, wrapped as user data in a fixed chat prompt (SPEC §7).
  text: z.string().min(1).max(4000),
  editTarget: z.enum(["dashboard", "template"]).optional(),
});

/**
 * POST /api/chat/messages — price and hold a chat message, then answer it (Quick, Edit) or run it
 * to its first browser query (Deep). The message type is the price (SPEC §27).
 */
export async function POST(request: Request): Promise<Response> {
  return withAccount(async (account) => {
    const consent = await processingConsentRequired(account.accountId);
    if (consent !== null) return consent;
    // SPEC §30: before any work or hold, so a flood cannot run up AI calls.
    const limited = await rateLimited("chat_per_account", account.accountId);
    if (limited !== null) return limited;
    const parsed = await parseJson(request, bodySchema);
    if (!parsed.ok) return parsed.response;
    const key = request.headers.get("idempotency-key") ?? "";
    try {
      return await idempotent(
        request,
        `chat:${account.accountId}`,
        parsed.raw,
        async () => {
          const pool = db();
          const sent = await sendMessage(pool, keyWrapper(), {
            accountId: account.accountId,
            companyId: parsed.data.companyId,
            threadId: parsed.data.threadId,
            type: parsed.data.type,
            tier: parsed.data.tier,
            text: parsed.data.text,
            ...(parsed.data.editTarget === undefined
              ? {}
              : { editTarget: parsed.data.editTarget }),
            idempotencyKey: key,
          });
          const progress = await processMessage(pool, keyWrapper(), aiTransport(), {
            accountId: account.accountId,
            messageId: sent.messageId,
          });
          return {
            status: 200,
            body: {
              messageId: sent.messageId,
              threadId: sent.threadId,
              priceCredits: sent.priceCredits.toString(),
              progress: progressBody(progress),
            },
          };
        },
      );
    } catch (error) {
      return jobErrorResponse(error);
    }
  });
}
