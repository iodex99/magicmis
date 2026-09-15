/** Manual account recovery as an audited, time-locked admin action (SPEC §8, R-21). */

import { randomBytes, randomUUID } from "node:crypto";

import { LocalKeyWrapper } from "@magicmis/crypto";
import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdmin } from "../src/server/identity";
import {
  cancelRecovery,
  completeRecovery,
  requestRecovery,
  type AuthFactorAdmin,
} from "../src/server/recovery";
import { base32Decode, hotp, timeStep } from "../src/server/totp";

let db: TestDb | undefined;
beforeAll(async () => {
  db = await startTestDb();
}, 180_000);
afterAll(async () => {
  await db?.stop();
});
const pool = () => {
  if (db === undefined) throw new Error("test database was not started");
  return db.pool;
};

const wrapper = new LocalKeyWrapper(randomBytes(32));
let tick = 0;
/**
 * Each step-up code is single-use: walk a timeline one TOTP period at a time, anchored to
 * the clock at the moment of the call rather than to one captured when this file loaded.
 * Under a loaded run the file can start minutes later, which would leave every fabricated
 * timestamp behind the real clock and the "fresh code" check refusing a current code.
 */
const next = () => new Date(Date.now() + (tick++ + 1) * 31_000);
const codeAt = (secret: string, at: Date) => hotp(base32Decode(secret), timeStep(at));

async function adminWithSecret() {
  const email = `${randomUUID()}@admin.example.test`;
  const a = await createAdmin(pool(), wrapper, {
    email,
    password: "correct-horse-battery-staple",
    allowlist: new Set([email]),
    issuer: "Test",
  });
  return { adminId: a.adminId, secret: a.totpSecret };
}

async function customerWithBackupCodes() {
  const a = await pool().query<{ id: string; auth_user_id: string }>(
    `insert into accounts (auth_user_id, email, business_name, state_code, active_session_id)
     values (gen_random_uuid(), $1, 'Recovery Co', '27', gen_random_uuid()) returning id, auth_user_id`,
    [`${randomUUID()}@example.test`],
  );
  const account = a.rows[0];
  if (account === undefined) throw new Error("no account");
  await pool().query(
    `insert into backup_codes (account_id, generation, code_hash) select $1, 1, 'scrypt$x' from generate_series(1, 3)`,
    [account.id],
  );
  return { accountId: account.id, authUserId: account.auth_user_id };
}

class FakeAuth implements AuthFactorAdmin {
  removed: string[] = [];
  removeTotpFactors(authUserId: string): Promise<number> {
    this.removed.push(authUserId);
    return Promise.resolve(1);
  }
}

describe("account recovery (R-21)", () => {
  it("records a verified request, holds, and only then removes the factor, revokes codes and ends the session", async () => {
    const support = await adminWithSecret();
    const c = await customerWithBackupCodes();
    const auth = new FakeAuth();

    let at = next();
    await expect(
      requestRecovery(pool(), wrapper, {
        adminId: support.adminId,
        ip: null,
        accountId: c.accountId,
        ticketRef: "T-1",
        reason: "short",
        code: codeAt(support.secret, at),
        now: at,
      }),
    ).rejects.toThrow(/20 to 500 characters/u);
    await expect(
      requestRecovery(pool(), wrapper, {
        adminId: support.adminId,
        ip: null,
        accountId: c.accountId,
        ticketRef: "T-1",
        reason: "Business name, address, GSTIN and last invoice all matched",
        code: "000000",
        now: at,
      }),
    ).rejects.toThrow(/authenticator code/u);

    const { recoveryId, holdUntil } = await requestRecovery(pool(), wrapper, {
      adminId: support.adminId,
      ip: null,
      accountId: c.accountId,
      ticketRef: "T-1",
      reason: "Business name, address, GSTIN and last invoice all matched",
      code: codeAt(support.secret, at),
      now: at,
    });
    expect(holdUntil.getTime()).toBe(at.getTime() + 24 * 3_600_000);
    const notice = await pool().query(
      `select 1 from notifications where account_id = $1 and type = 'security.recovery_requested'`,
      [c.accountId],
    );
    expect(notice.rowCount).toBe(1);
    // One open request per account.
    at = next();
    await expect(
      requestRecovery(pool(), wrapper, {
        adminId: support.adminId,
        ip: null,
        accountId: c.accountId,
        ticketRef: "T-2",
        reason: "Business name, address, GSTIN and last invoice all matched",
        code: codeAt(support.secret, at),
        now: at,
      }),
    ).rejects.toThrow(/already has an open recovery/u);

    // During the hold nothing can be removed.
    at = next();
    await expect(
      completeRecovery(pool(), wrapper, auth, {
        adminId: support.adminId,
        ip: null,
        recoveryId,
        code: codeAt(support.secret, at),
        now: at,
      }),
    ).rejects.toThrow(/hold ends/u);
    expect(auth.removed).toEqual([]);

    const afterHold = new Date(holdUntil.getTime() + 31_000 * (tick + 1));
    const done = await completeRecovery(pool(), wrapper, auth, {
      adminId: support.adminId,
      ip: null,
      recoveryId,
      code: codeAt(support.secret, afterHold),
      now: afterHold,
    });
    expect(done.factorsRemoved).toBe(1);
    expect(auth.removed).toEqual([c.authUserId]);
    const state = await pool().query<{ live_codes: number; session: string | null }>(
      `select (select count(*)::int from backup_codes where account_id = $1 and revoked_at is null) as live_codes,
              (select active_session_id::text from accounts where id = $1) as session`,
      [c.accountId],
    );
    expect(state.rows[0]).toEqual({ live_codes: 0, session: null });
    const audit = await pool().query<{
      action: string;
      metadata: Record<string, unknown>;
    }>(`select action, metadata from audit_log where target_id = $1 order by seq`, [
      c.accountId,
    ]);
    expect(audit.rows.map((r) => r.action)).toEqual([
      "auth.recovery_requested",
      "auth.mfa_reset_by_admin",
    ]);
    expect(JSON.stringify(audit.rows)).not.toContain("GSTIN and last invoice");
    const reset = await pool().query(
      `select 1 from notifications where account_id = $1 and type = 'security.mfa_reset_by_admin'`,
      [c.accountId],
    );
    expect(reset.rowCount).toBe(1);
  });

  it("can be cancelled during the hold, and with the two-admin rule the requester cannot complete it", async () => {
    const support = await adminWithSecret();
    const reviewer = await adminWithSecret();
    const c = await customerWithBackupCodes();
    const auth = new FakeAuth();

    let at = next();
    const cancelled = await requestRecovery(pool(), wrapper, {
      adminId: support.adminId,
      ip: null,
      accountId: c.accountId,
      ticketRef: "T-3",
      reason: "Details matched; customer replied from the registered address",
      code: codeAt(support.secret, at),
      now: at,
    });
    await cancelRecovery(pool(), {
      adminId: reviewer.adminId,
      ip: null,
      recoveryId: cancelled.recoveryId,
      now: at,
    });
    await expect(
      completeRecovery(pool(), wrapper, auth, {
        adminId: reviewer.adminId,
        ip: null,
        recoveryId: cancelled.recoveryId,
        code: codeAt(reviewer.secret, at),
        now: new Date(cancelled.holdUntil.getTime() + 60_000),
      }),
    ).rejects.toThrow(/no open recovery/u);

    const cfg = await pool().query<{ version: number }>(
      `insert into app_config (key, value, version, effective_from)
       select 'admin.recovery_second_admin', 'true'::jsonb, coalesce(max(version), 0) + 1, now() - interval '1 second'
       from app_config where key = 'admin.recovery_second_admin' returning version`,
    );
    try {
      at = next();
      const open = await requestRecovery(pool(), wrapper, {
        adminId: support.adminId,
        ip: null,
        accountId: c.accountId,
        ticketRef: "T-4",
        reason: "Details matched; customer replied from the registered address",
        code: codeAt(support.secret, at),
        now: at,
      });
      const later = new Date(open.holdUntil.getTime() + 31_000 * (tick + 5));
      await expect(
        completeRecovery(pool(), wrapper, auth, {
          adminId: support.adminId,
          ip: null,
          recoveryId: open.recoveryId,
          code: codeAt(support.secret, later),
          now: later,
        }),
      ).rejects.toThrow(/different admin/u);
      const done = await completeRecovery(pool(), wrapper, auth, {
        adminId: reviewer.adminId,
        ip: null,
        recoveryId: open.recoveryId,
        code: codeAt(reviewer.secret, later),
        now: later,
      });
      expect(done.factorsRemoved).toBe(1);
    } finally {
      await pool().query(
        `delete from app_config where key = 'admin.recovery_second_admin' and version = $1`,
        [cfg.rows[0]?.version],
      );
    }
  });
});
