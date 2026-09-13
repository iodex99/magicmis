/**
 * Backup-code issue, regeneration and redemption (SPEC §8).
 */

import { appendAudit } from "@magicmis/db/audit";
import { readConfig } from "@magicmis/db/config";
import { withTransaction } from "@magicmis/db/tx";
import type { Pool } from "pg";
import { z } from "zod";

import {
  generateBackupCodes,
  hashBackupCode,
  isWellFormedBackupCode,
  normaliseBackupCode,
  verifyBackupCode,
} from "./backup-codes";
import { sessionClaimsSchema, type AccountContext } from "./claims";
import { enqueueNotification } from "./notifications";
import { type AuthProvider } from "./provider";
import {
  checkThrottle,
  clearThrottle,
  registerFailure,
  throttleLimitFor,
} from "./throttle";

/**
 * Replace the account's backup codes with a new generation and return the plaintext
 * codes -- the only time they ever exist outside the user's hands.
 *
 * Used both at first TOTP enrolment and for regeneration. For regeneration the caller must
 * first confirm `hasFreshReauth` (SPEC §8); this function does not re-check, because at
 * first enrolment there is nothing to re-authenticate against yet.
 */
export async function issueBackupCodes(
  pool: Pool,
  accountId: string,
  context: { ip: string | null; reason: "enrolment" | "regeneration" },
): Promise<string[]> {
  const count = await readConfig(
    pool,
    "auth.backup_code_count",
    z.number().int().min(1).max(50),
  );
  const codes = generateBackupCodes(count);
  // Hash outside the transaction: scrypt is deliberately slow and must not hold row locks.
  const hashes = await Promise.all(codes.map(hashBackupCode));

  await withTransaction(pool, async (tx) => {
    await tx.query(`select id from public.accounts where id = $1 for update`, [
      accountId,
    ]);
    const generation = await tx.query<{ next: number }>(
      `select coalesce(max(generation), 0) + 1 as next from public.backup_codes where account_id = $1`,
      [accountId],
    );
    const next = generation.rows[0]?.next ?? 1;

    await tx.query(
      `update public.backup_codes set revoked_at = now()
       where account_id = $1 and used_at is null and revoked_at is null`,
      [accountId],
    );
    for (const hash of hashes) {
      await tx.query(
        `insert into public.backup_codes (account_id, generation, code_hash) values ($1, $2, $3)`,
        [accountId, next, hash],
      );
    }

    if (context.reason === "regeneration") {
      await tx.query(
        `insert into public.login_events (account_id, event_type, ip)
         values ($1, 'backup_codes_regenerated', $2)`,
        [accountId, context.ip],
      );
      await enqueueNotification(tx, {
        accountId,
        type: "security.backup_codes_regenerated",
        payload: {},
        dedupeKey: `backup_codes:${String(next)}`,
      });
    }

    await appendAudit(tx, {
      actorType: "account",
      actorId: accountId,
      action:
        context.reason === "enrolment"
          ? "auth.backup_codes_issued"
          : "auth.backup_codes_regenerated",
      targetType: "account",
      targetId: accountId,
      metadata: { generation: next, count },
      ip: context.ip,
    });
  });

  return codes;
}

export type RedeemResult =
  | { readonly status: "factors_reset" }
  | { readonly status: "invalid_code"; readonly attemptsRemaining: number }
  | { readonly status: "locked"; readonly lockedUntil: Date }
  | { readonly status: "refused"; readonly reason: "invalid_claims" | "no_account" };

/**
 * Redeem a backup code for a user who has passed the password step (aal1) but lost their
 * authenticator.
 *
 * A backup code never produces an aal2 session by itself. It removes the user's TOTP
 * factors so they can enrol a new authenticator, and reaching aal2 still requires
 * verifying that new factor. The single-use mark and the factor removal happen in one
 * transaction: if the provider call fails, the code is not consumed.
 */
export async function redeemBackupCode(
  pool: Pool,
  provider: AuthProvider,
  rawClaims: unknown,
  input: { code: string; ip: string | null },
  now: Date = new Date(),
): Promise<RedeemResult> {
  const parsed = sessionClaimsSchema.safeParse(rawClaims);
  if (!parsed.success) return { status: "refused", reason: "invalid_claims" };
  const claims = parsed.data;

  const accountRow = await pool.query<{ id: string }>(
    `select id from public.accounts where auth_user_id = $1 and deleted_at is null`,
    [claims.sub],
  );
  const accountId = accountRow.rows[0]?.id;
  if (accountId === undefined) return { status: "refused", reason: "no_account" };

  const limit = await throttleLimitFor(pool, "backup_code");
  const keys = [
    `backup_code:account:${accountId}`,
    ...(input.ip === null ? [] : [`backup_code:ip:${input.ip}`]),
  ];
  for (const key of keys) {
    const state = await checkThrottle(pool, key, now);
    if (state.locked) return { status: "locked", lockedUntil: state.lockedUntil };
  }

  const normalised = normaliseBackupCode(input.code);

  const live = await pool.query<{ id: string; code_hash: string }>(
    `select id, code_hash from public.backup_codes
     where account_id = $1 and used_at is null and revoked_at is null`,
    [accountId],
  );

  let matchId: string | null = null;
  if (isWellFormedBackupCode(normalised)) {
    // Check every live code rather than stopping at the first match, so the time taken
    // does not reveal how many codes remain before the matching one.
    for (const row of live.rows) {
      if ((await verifyBackupCode(normalised, row.code_hash)) && matchId === null) {
        matchId = row.id;
      }
    }
  }

  if (matchId === null) {
    // Values come back out of the transaction rather than being assigned inside the
    // callback: mutations inside a closure are invisible to TypeScript's narrowing, which
    // would otherwise conclude the lock result is always null.
    const { lockedUntil, attempts } = await withTransaction(pool, async (tx) => {
      let locked: Date | null = null;
      let most = 0;
      for (const key of keys) {
        const result = await registerFailure(tx, key, limit, now);
        if (result.locked) locked = result.lockedUntil;
        else most = Math.max(most, result.attempts);
      }
      await tx.query(
        `insert into public.login_events (account_id, event_type, ip) values ($1, 'mfa_failed', $2)`,
        [accountId, input.ip],
      );
      return { lockedUntil: locked, attempts: most };
    });
    return lockedUntil === null
      ? {
          status: "invalid_code",
          attemptsRemaining: Math.max(0, limit.max_attempts - attempts),
        }
      : { status: "locked", lockedUntil };
  }

  const consumed = await withTransaction(pool, async (tx) => {
    // Conditional update: two concurrent redemptions of the same code cannot both succeed.
    const updated = await tx.query(
      `update public.backup_codes set used_at = $2
       where id = $1 and used_at is null and revoked_at is null`,
      [matchId, now],
    );
    if (updated.rowCount !== 1) return false;

    await provider.deleteTotpFactors(claims.sub);

    for (const key of keys) await clearThrottle(tx, key);
    await tx.query(
      `insert into public.login_events (account_id, event_type, ip)
       values ($1, 'mfa_reset_with_backup_code', $2)`,
      [accountId, input.ip],
    );
    await enqueueNotification(tx, {
      accountId,
      type: "security.mfa_reset_with_backup_code",
      payload: {},
      dedupeKey: `backup_code_used:${matchId}`,
    });
    await appendAudit(tx, {
      actorType: "account",
      actorId: accountId,
      action: "auth.mfa_reset_with_backup_code",
      targetType: "account",
      targetId: accountId,
      metadata: {},
      ip: input.ip,
    });
    return true;
  });

  return consumed
    ? { status: "factors_reset" }
    : { status: "invalid_code", attemptsRemaining: limit.max_attempts };
}

/** How many unused codes remain, for the Security settings page. */
export async function remainingBackupCodes(
  pool: Pool,
  account: AccountContext,
): Promise<number> {
  const result = await pool.query<{ n: string }>(
    `select count(*)::text as n from public.backup_codes
     where account_id = $1 and used_at is null and revoked_at is null`,
    [account.accountId],
  );
  return Number.parseInt(result.rows[0]?.n ?? "0", 10);
}
