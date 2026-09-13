import "server-only";

/**
 * Manual account recovery (SPEC §8, R-21, docs/runbooks/account-recovery.md) for a customer who has
 * lost both their authenticator and their backup codes. The verification questions happen by email
 * outside the system; this module is the audited, time-locked part:
 *
 *   request (admin step-up, ticket, reason) → customer emailed, hold of `admin.recovery_hold_hours`
 *   → cancel (any admin, or the customer replying) or complete (after the hold; a second admin when
 *     `admin.recovery_second_admin` is on) → TOTP factors removed in Supabase Auth, backup codes
 *     revoked, session ended, customer emailed.
 *
 * There is no path that disables 2FA: the customer must enrol a new authenticator at next sign-in.
 */

import type { KeyWrapper } from "@magicmis/crypto";
import { appendAudit } from "@magicmis/db/audit";
import { readConfig } from "@magicmis/db/config";
import { withTransaction } from "@magicmis/db/tx";
import { queueNotification } from "@magicmis/jobs";
import type { Pool } from "pg";
import { z } from "zod";

import { StepUpRequired } from "./console";
import { verifyAdminStepUp } from "./identity";

/** The Supabase Auth admin calls recovery needs, typed structurally so tests can supply a fake. */
export interface AuthFactorAdmin {
  /** Removes every TOTP factor of the user; returns how many were removed. */
  removeTotpFactors(authUserId: string): Promise<number>;
}

export class RecoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecoveryError";
  }
}

export async function requestRecovery(
  pool: Pool,
  wrapper: KeyWrapper,
  input: {
    adminId: string;
    ip: string | null;
    accountId: string;
    ticketRef: string;
    reason: string;
    code: string;
    now?: Date;
  },
): Promise<{ recoveryId: string; holdUntil: Date }> {
  const now = input.now ?? new Date();
  const ticketRef = input.ticketRef.trim();
  const reason = input.reason.trim();
  if (ticketRef === "" || ticketRef.length > 100)
    throw new RecoveryError("give the support ticket reference");
  if (reason.length < 20 || reason.length > 500)
    throw new RecoveryError(
      "describe the verification done, in 20 to 500 characters (no answers)",
    );
  const holdHours = await readConfig(
    pool,
    "admin.recovery_hold_hours",
    z.number().int().positive(),
    now,
  );
  const holdUntil = new Date(now.getTime() + holdHours * 3_600_000);
  return withTransaction(pool, async (tx) => {
    if (
      !(await verifyAdminStepUp(tx, wrapper, {
        adminId: input.adminId,
        code: input.code,
        now,
      }))
    )
      throw new StepUpRequired();
    const acct = await tx.query<{ status: string }>(
      `select status from public.accounts where id = $1 and deleted_at is null for update`,
      [input.accountId],
    );
    if (acct.rows[0] === undefined) throw new RecoveryError("account not found");
    const open = await tx.query(
      `select 1 from public.account_recoveries where account_id = $1 and cancelled_at is null and completed_at is null`,
      [input.accountId],
    );
    if (open.rows.length > 0)
      throw new RecoveryError("this account already has an open recovery request");
    const r = await tx.query<{ id: string }>(
      `insert into public.account_recoveries (account_id, requested_by, ticket_ref, reason, requested_at, hold_until)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [input.accountId, input.adminId, ticketRef, reason, now, holdUntil],
    );
    const recoveryId = r.rows[0]?.id ?? "";
    await appendAudit(tx, {
      actorType: "admin",
      actorId: input.adminId,
      action: "auth.recovery_requested",
      targetType: "account",
      targetId: input.accountId,
      // Ids and the ticket only: never the verification answers.
      metadata: { recoveryId, ticketRef, holdUntil: holdUntil.toISOString() },
      ip: input.ip,
    });
    await queueNotification(tx, {
      accountId: input.accountId,
      type: "security.recovery_requested",
      payload: { hold_until: holdUntil.toISOString() },
      dedupeKey: `recovery_requested:${recoveryId}`,
    });
    return { recoveryId, holdUntil };
  });
}

export async function cancelRecovery(
  pool: Pool,
  input: { adminId: string; ip: string | null; recoveryId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  await withTransaction(pool, async (tx) => {
    const r = await tx.query<{ account_id: string }>(
      `update public.account_recoveries set cancelled_at = $2, cancelled_by = $3
       where id = $1 and cancelled_at is null and completed_at is null returning account_id`,
      [input.recoveryId, now, input.adminId],
    );
    const accountId = r.rows[0]?.account_id;
    if (accountId === undefined) throw new RecoveryError("no open recovery request");
    await appendAudit(tx, {
      actorType: "admin",
      actorId: input.adminId,
      action: "auth.recovery_cancelled",
      targetType: "account",
      targetId: accountId,
      metadata: { recoveryId: input.recoveryId },
      ip: input.ip,
    });
  });
}

/**
 * After the hold: remove the second factor. The Supabase call runs inside the transaction that
 * locks the request, so a failure there leaves the request open to retry and nothing half-done in
 * our records; removing factors twice is harmless (the second call finds none).
 */
export async function completeRecovery(
  pool: Pool,
  wrapper: KeyWrapper,
  auth: AuthFactorAdmin,
  input: {
    adminId: string;
    ip: string | null;
    recoveryId: string;
    code: string;
    now?: Date;
  },
): Promise<{ factorsRemoved: number }> {
  const now = input.now ?? new Date();
  const secondAdmin = await readConfig(
    pool,
    "admin.recovery_second_admin",
    z.boolean(),
    now,
  );
  return withTransaction(pool, async (tx) => {
    const r = await tx.query<{
      account_id: string;
      requested_by: string;
      ticket_ref: string;
      hold_until: Date;
      auth_user_id: string;
    }>(
      `select r.account_id, r.requested_by, r.ticket_ref, r.hold_until, a.auth_user_id
       from public.account_recoveries r join public.accounts a on a.id = r.account_id
       where r.id = $1 and r.cancelled_at is null and r.completed_at is null
       for update of r`,
      [input.recoveryId],
    );
    const rec = r.rows[0];
    if (rec === undefined) throw new RecoveryError("no open recovery request");
    if (now < rec.hold_until)
      throw new RecoveryError(
        `the hold ends at ${rec.hold_until.toISOString()}; the customer may still cancel`,
      );
    if (secondAdmin && rec.requested_by === input.adminId)
      throw new RecoveryError("a different admin must complete this recovery");
    if (
      !(await verifyAdminStepUp(tx, wrapper, {
        adminId: input.adminId,
        code: input.code,
        now,
      }))
    )
      throw new StepUpRequired();

    const factorsRemoved = await auth.removeTotpFactors(rec.auth_user_id);
    await tx.query(
      `update public.backup_codes set revoked_at = $2 where account_id = $1 and used_at is null and revoked_at is null`,
      [rec.account_id, now],
    );
    await tx.query(`update public.accounts set active_session_id = null where id = $1`, [
      rec.account_id,
    ]);
    await tx.query(
      `update public.account_recoveries set completed_at = $2, completed_by = $3, factors_removed = $4 where id = $1`,
      [input.recoveryId, now, input.adminId, factorsRemoved],
    );
    await appendAudit(tx, {
      actorType: "admin",
      actorId: input.adminId,
      action: "auth.mfa_reset_by_admin",
      targetType: "account",
      targetId: rec.account_id,
      metadata: {
        recoveryId: input.recoveryId,
        ticketRef: rec.ticket_ref,
        requestedBy: rec.requested_by,
        completedBy: input.adminId,
        factorsRemoved,
      },
      ip: input.ip,
    });
    await queueNotification(tx, {
      accountId: rec.account_id,
      type: "security.mfa_reset_by_admin",
      payload: {},
      dedupeKey: `mfa_reset_by_admin:${input.recoveryId}`,
    });
    return { factorsRemoved };
  });
}

export async function recoveriesFor(pool: Pool, accountId: string) {
  const r = await pool.query<{
    id: string;
    requested_by: string;
    requested_email: string;
    ticket_ref: string;
    reason: string;
    requested_at: Date;
    hold_until: Date;
    cancelled_at: Date | null;
    completed_at: Date | null;
    factors_removed: number | null;
  }>(
    `select r.id, r.requested_by, a.email as requested_email, r.ticket_ref, r.reason, r.requested_at,
            r.hold_until, r.cancelled_at, r.completed_at, r.factors_removed
     from public.account_recoveries r join public.admin_users a on a.id = r.requested_by
     where r.account_id = $1 order by r.requested_at desc limit 10`,
    [accountId],
  );
  return r.rows;
}
