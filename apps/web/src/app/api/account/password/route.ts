import { hasFreshReauth, signupRequestSchema } from "@magicmis/accounts";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, idempotent, parseJson, requestMeta, withAccount } from "@/lib/http";
import { setAccountPassword } from "@/lib/server/password";

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
        const result = await setAccountPassword({
          accountId: account.accountId,
          authUserId: account.authUserId,
          newPassword: parsed.data.newPassword,
          ip,
          dedupeKey: request.headers.get("idempotency-key") ?? "",
          via: "settings",
        });
        if (result === "rejected") {
          return {
            status: 422,
            body: {
              error: "password_rejected",
              message: "That password cannot be used. Choose a different one.",
            },
          };
        }
        return { status: 200, body: { status: "updated" } };
      },
    );
  });
}
