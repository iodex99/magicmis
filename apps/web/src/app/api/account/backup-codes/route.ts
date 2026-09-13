import {
  hasFreshReauth,
  issueBackupCodes,
  remainingBackupCodes,
} from "@magicmis/accounts";

import { db } from "@/lib/db";
import { apiError, idempotent, ok, requestMeta, withAccount } from "@/lib/http";

/** GET /api/account/backup-codes — how many unused codes remain. Never the codes. */
export async function GET(): Promise<Response> {
  return withAccount(async (account) =>
    ok({ remaining: await remainingBackupCodes(db(), account) }),
  );
}

/**
 * POST /api/account/backup-codes — regenerate (SPEC §8: requires re-authentication).
 * The new codes are returned once and the response is never stored or replayed.
 */
export async function POST(request: Request): Promise<Response> {
  return withAccount(async (account) => {
    if (!(await hasFreshReauth(db(), account))) {
      return apiError(
        403,
        "reauth_required",
        "Confirm your password and authenticator code to regenerate backup codes.",
      );
    }
    const { ip } = await requestMeta();
    return idempotent(
      request,
      `account:${account.accountId}`,
      { action: "regenerate_backup_codes" },
      async () => {
        const codes = await issueBackupCodes(db(), account.accountId, {
          ip,
          reason: "regeneration",
        });
        return { status: 200, body: { backupCodes: codes }, containsSecret: true };
      },
    );
  });
}
