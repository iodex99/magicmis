/**
 * Re-authentication gates (SPEC §8).
 *
 * Password + TOTP is required before: changing email, changing password, regenerating
 * backup codes, deleting a company, deleting the account, and exporting data. A
 * successful re-auth grants a short window, bound to the current session, during which
 * those actions proceed. The window length is config (`auth.reauth_ttl_seconds`).
 */

import { appendAudit } from "@magicmis/db/audit";
import { readConfig } from "@magicmis/db/config";
import { one, withTransaction, type Queryable } from "@magicmis/db/tx";
import type { Pool } from "pg";
import { z } from "zod";

import { type AccountContext } from "./claims.js";
import { type AuthProvider } from "./provider.js";
import {
  checkThrottle,
  clearThrottle,
  registerFailure,
  throttleLimitFor,
} from "./throttle.js";

export type ReauthAction =
  | "change_email"
  | "change_password"
  | "regenerate_backup_codes"
  | "delete_company"
  | "delete_account"
  | "export_data";

export type ReauthResult =
  | { readonly status: "granted"; readonly expiresAt: Date }
  | { readonly status: "invalid_credentials"; readonly attemptsRemaining: number }
  | { readonly status: "locked"; readonly lockedUntil: Date };

export async function reauthenticate(
  pool: Pool,
  provider: AuthProvider,
  account: AccountContext,
  input: { password: string; totpCode: string; ip: string | null },
  now: Date = new Date(),
): Promise<ReauthResult> {
  const key = `reauth:account:${account.accountId}`;
  const limit = await throttleLimitFor(pool, "reauth");

  const state = await checkThrottle(pool, key, now);
  if (state.locked) return { status: "locked", lockedUntil: state.lockedUntil };

  // Both checks always run. Short-circuiting on a wrong password would let an attacker
  // learn which factor failed from the response time.
  const [passwordOk, totpOk] = await Promise.all([
    provider.verifyPassword(account.email, input.password),
    /^\d{6}$/u.test(input.totpCode)
      ? provider.verifyTotp(input.totpCode)
      : Promise.resolve(false),
  ]);

  if (!passwordOk || !totpOk) {
    const after = await withTransaction(pool, async (tx) => {
      const result = await registerFailure(tx, key, limit, now);
      await tx.query(
        `insert into public.login_events (account_id, event_type, ip)
         values ($1, $2, $3)`,
        [account.accountId, result.locked ? "locked_out" : "reauth_failed", input.ip],
      );
      await appendAudit(tx, {
        actorType: "account",
        actorId: account.accountId,
        action: result.locked ? "auth.reauth_locked" : "auth.reauth_failed",
        targetType: "account",
        targetId: account.accountId,
        metadata: {},
        ip: input.ip,
      });
      return result;
    });
    return after.locked
      ? { status: "locked", lockedUntil: after.lockedUntil }
      : {
          status: "invalid_credentials",
          attemptsRemaining: Math.max(0, limit.max_attempts - after.attempts),
        };
  }

  const ttlSeconds = await readConfig(
    pool,
    "auth.reauth_ttl_seconds",
    z.number().int().positive(),
  );
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  await withTransaction(pool, async (tx) => {
    await clearThrottle(tx, key);
    await tx.query(
      `insert into public.reauth_grants (account_id, session_id, granted_at, expires_at)
       values ($1, $2, $3, $4)`,
      [account.accountId, account.sessionId, now, expiresAt],
    );
    await tx.query(
      `insert into public.login_events (account_id, event_type, ip) values ($1, 'reauth', $2)`,
      [account.accountId, input.ip],
    );
    await appendAudit(tx, {
      actorType: "account",
      actorId: account.accountId,
      action: "auth.reauth_granted",
      targetType: "account",
      targetId: account.accountId,
      metadata: { ttlSeconds },
      ip: input.ip,
    });
  });

  return { status: "granted", expiresAt };
}

/**
 * Whether the current session holds an unexpired re-auth grant. Sensitive route handlers
 * call this and refuse with `reauth_required` otherwise.
 *
 * Bound to the session: a grant earned on one session is invisible to any other.
 */
export async function hasFreshReauth(
  db: Queryable,
  account: AccountContext,
  now: Date = new Date(),
): Promise<boolean> {
  const row = await one<{ ok: boolean }>(
    db,
    `select exists (
       select 1 from public.reauth_grants
       where account_id = $1 and session_id = $2
         and expires_at > $3 and consumed_at is null
     ) as ok`,
    [account.accountId, account.sessionId, now],
  );
  return row?.ok === true;
}
