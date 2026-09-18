import "server-only";

import { enqueueNotification } from "@magicmis/accounts";
import { appendAudit } from "@magicmis/db/audit";
import { withTransaction } from "@magicmis/db/tx";

import { db } from "@/lib/db";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Set an account's password, and everything that has to happen with it (SPEC §8, ADR 0043).
 *
 * One place, because there are two ways here — changing it from Security settings after the
 * password re-check, and setting it from an emailed reset link — and both must leave the same
 * trail: the login event, the "your password changed" notice, the audit entry, and
 * `has_password`, which is what tells the re-check that there is now something to check.
 *
 * The caller has already established that this request may set this account's password.
 */
export async function setAccountPassword(input: {
  accountId: string;
  authUserId: string;
  newPassword: string;
  ip: string | null;
  /** Distinguishes one change from a retry of the same one, for the notice. */
  dedupeKey: string;
  via: "settings" | "reset_link";
}): Promise<"updated" | "rejected"> {
  const { error } = await supabaseAdmin().auth.admin.updateUserById(input.authUserId, {
    password: input.newPassword,
  });
  if (error !== null) return "rejected";

  await withTransaction(db(), async (tx) => {
    await tx.query(`update public.accounts set has_password = true where id = $1`, [
      input.accountId,
    ]);
    await tx.query(
      `insert into public.login_events (account_id, event_type, ip) values ($1, 'password_changed', $2)`,
      [input.accountId, input.ip],
    );
    await enqueueNotification(tx, {
      accountId: input.accountId,
      type: "security.password_changed",
      payload: {},
      dedupeKey: `password_changed:${input.dedupeKey}`,
    });
    await appendAudit(tx, {
      actorType: "account",
      actorId: input.accountId,
      action: "auth.password_changed",
      targetType: "account",
      targetId: input.accountId,
      metadata: { via: input.via },
      ip: input.ip,
    });
  });
  return "updated";
}
