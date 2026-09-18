/**
 * Re-authentication gates (SPEC §8).
 *
 * The password is required again before: changing email, changing password, deleting a
 * company, deleting the account, and exporting data. A successful re-auth grants a short
 * window, bound to the current session, during which those actions proceed. The window
 * length is config (`auth.reauth_ttl_seconds`).
 *
 * There is no second factor to ask for (ADR 0028), so this is what stands between someone
 * who walked up to an unlocked machine and an irreversible action. The throttle below is
 * therefore load-bearing, not a formality.
 */

import { appendAudit } from "@magicmis/db/audit";
import { readConfig } from "@magicmis/db/config";
import { one, withTransaction, type Queryable } from "@magicmis/db/tx";
import type { Pool } from "pg";
import { z } from "zod";

import { type AccountContext } from "./claims";
import { type AuthProvider } from "./provider";
import {
  checkThrottle,
  clearThrottle,
  registerFailure,
  throttleLimitFor,
} from "./throttle";

export type ReauthAction =
  | "change_email"
  | "change_password"
  | "delete_company"
  | "delete_account"
  | "export_data";

export type ReauthResult =
  | { readonly status: "granted"; readonly expiresAt: Date }
  | { readonly status: "invalid_credentials"; readonly attemptsRemaining: number }
  | { readonly status: "locked"; readonly lockedUntil: Date }
  /** The account signs in through Google or Apple and has never set a password (ADR 0043). */
  | { readonly status: "password_not_set" };

export async function reauthenticate(
  pool: Pool,
  provider: AuthProvider,
  account: AccountContext,
  input: { password: string; ip: string | null },
  now: Date = new Date(),
): Promise<ReauthResult> {
  const key = `reauth:account:${account.accountId}`;
  const limit = await throttleLimitFor(pool, "reauth");

  const state = await checkThrottle(pool, key, now);
  if (state.locked) return { status: "locked", lockedUntil: state.lockedUntil };

  // Nothing to compare against, so nothing to count as a failed attempt either: the way
  // through is the emailed link that sets a password, not a guess.
  const credentials = await one<{ has_password: boolean }>(
    pool,
    `select has_password from public.accounts where id = $1`,
    [account.accountId],
  );
  if (credentials?.has_password === false) return { status: "password_not_set" };

  const passwordOk = await provider.verifyPassword(account.email, input.password);

  if (!passwordOk) {
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
