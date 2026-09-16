import {
  enqueueNotification,
  hasFreshReauth,
  signupRequestSchema,
} from "@magicmis/accounts";
import { appendAudit } from "@magicmis/db/audit";
import { withTransaction } from "@magicmis/db/tx";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, idempotent, parseJson, requestMeta, withAccount } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/server";

const bodySchema = z.object({ newPassword: signupRequestSchema.shape.password });

/**
 * POST /api/account/password — change password (SPEC §8: requires re-authentication).
 *
 * Set through the admin API because this product's re-auth (the password again, session
 * bound) is the gate. Supabase's own `secure_password_change` check would otherwise demand
 * a separate emailed nonce on top.
 */
export async function POST(request: Request): Promise<Response> {
  return withAccount(async (account) => {
    if (!(await hasFreshReauth(db(), account))) {
      return apiError(403, "reauth_required", "Confirm your current password first.");
    }
    const parsed = await parseJson(request, bodySchema);
    if (!parsed.ok) return parsed.response;
    const { ip } = await requestMeta();

    // The body holds a password: hash only a constant for idempotency, never the value.
    return idempotent(
      request,
      `account:${account.accountId}`,
      { action: "change_password" },
      async () => {
        const { error } = await supabaseAdmin().auth.admin.updateUserById(
          account.authUserId,
          {
            password: parsed.data.newPassword,
          },
        );
        if (error !== null) {
          return {
            status: 422,
            body: {
              error: "password_rejected",
              message: "That password cannot be used. Choose a different one.",
            },
          };
        }
        await withTransaction(db(), async (tx) => {
          await tx.query(
            `insert into public.login_events (account_id, event_type, ip) values ($1, 'password_changed', $2)`,
            [account.accountId, ip],
          );
          await enqueueNotification(tx, {
            accountId: account.accountId,
            type: "security.password_changed",
            payload: {},
            dedupeKey: `password_changed:${request.headers.get("idempotency-key") ?? ""}`,
          });
          await appendAudit(tx, {
            actorType: "account",
            actorId: account.accountId,
            action: "auth.password_changed",
            targetType: "account",
            targetId: account.accountId,
            metadata: {},
            ip,
          });
        });
        return { status: 200, body: { status: "updated" } };
      },
    );
  });
}
