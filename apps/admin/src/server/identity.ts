/**
 * Admin identity (SPEC §26, ADR 0015): separate from customer auth. An admin signs in with
 * an allowlisted email, a scrypt-hashed password and a TOTP code, all in one step, and gets
 * a short server-side session. Every outcome is audit-logged.
 */

import { createHash, randomBytes } from "node:crypto";

import { openWithWrappedKey, sealWithNewKey, type KeyWrapper } from "@magicmis/crypto";
import { appendAudit, appendAuditInTransaction } from "@magicmis/db/audit";
import { readConfig } from "@magicmis/db/config";
import { withTransaction, type Queryable } from "@magicmis/db/tx";
import type { Pool } from "pg";
import { z } from "zod";

import { hashPassword, verifyPassword } from "./password";
import { generateTotpSecret, otpauthUri, verifyTotp } from "./totp";

export const normaliseEmail = (email: string): string => email.trim().toLowerCase();

export function parseAllowlist(value: string): ReadonlySet<string> {
  return new Set(
    value
      .split(",")
      .map(normaliseEmail)
      .filter((e) => e !== ""),
  );
}

const totpContext = (adminId: string) => ({ purpose: "admin_totp", admin_id: adminId });

export async function createAdmin(
  pool: Pool,
  wrapper: KeyWrapper,
  input: {
    email: string;
    password: string;
    allowlist: ReadonlySet<string>;
    issuer: string;
  },
): Promise<{ adminId: string; totpSecret: string; otpauthUri: string }> {
  const email = normaliseEmail(input.email);
  if (!input.allowlist.has(email))
    throw new Error("createAdmin: email is not on ADMIN_ALLOWED_EMAILS");
  const passwordHash = await hashPassword(input.password);
  const secret = generateTotpSecret();

  return withTransaction(pool, async (tx) => {
    const id =
      (await tx.query<{ id: string }>(`select gen_random_uuid() as id`)).rows[0]?.id ??
      "";
    const { sealed, wrapped } = await sealWithNewKey(
      wrapper,
      Buffer.from(secret, "utf8"),
      totpContext(id),
    );
    await tx.query(
      `insert into public.admin_users (id, email, password_hash, totp_secret_enc, totp_key_wrapped, totp_key_version)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        email,
        passwordHash,
        sealed,
        Buffer.from(wrapped.ciphertext),
        wrapped.keyVersion,
      ],
    );
    await appendAudit(tx, {
      actorType: "system",
      action: "admin.created",
      targetType: "admin",
      targetId: id,
      metadata: { email },
    });
    return {
      adminId: id,
      totpSecret: secret,
      otpauthUri: otpauthUri({ issuer: input.issuer, account: email, secret }),
    };
  });
}

export const tokenHash = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export type LoginResult =
  | {
      readonly ok: true;
      readonly token: string;
      readonly adminId: string;
      readonly expiresAt: Date;
    }
  | {
      readonly ok: false;
      readonly reason: "invalid_credentials" | "locked_out" | "ip_not_allowed";
    };

// One generic refusal for every credential failure, so the response never reveals which
// of email, password or code was wrong.
const INVALID = { ok: false, reason: "invalid_credentials" } as const;

async function recentFailures(
  db: Queryable,
  email: string,
  now: Date,
): Promise<{ count: number; limit: number }> {
  const limit = await readConfig(
    db,
    "admin.login_max_failures",
    z.number().int().positive(),
  );
  const window = await readConfig(
    db,
    "admin.login_lockout_seconds",
    z.number().int().positive(),
  );
  // Failures count from the latest of: the window start, the last successful sign-in, or
  // the admin's creation. Refusals made while locked out do not extend the lockout.
  const r = await db.query<{ n: string }>(
    `select count(*)::text as n from public.audit_log
     where action = 'admin.login_failed' and metadata->>'email' = $1
       and coalesce(metadata->>'reason', '') <> 'locked_out'
       and created_at > greatest($2::timestamptz,
         (select max(greatest(created_at, coalesce(last_login_at, created_at)))
          from public.admin_users where lower(email) = $1))`,
    [email, new Date(now.getTime() - window * 1000)],
  );
  return { count: Number.parseInt(r.rows[0]?.n ?? "0", 10), limit };
}

export async function signIn(
  pool: Pool,
  wrapper: KeyWrapper,
  input: {
    email: string;
    password: string;
    code: string;
    allowlist: ReadonlySet<string>;
    ipAllowlist: ReadonlySet<string> | null;
    ip: string | null;
    userAgent: string;
    now?: Date;
  },
): Promise<LoginResult> {
  const now = input.now ?? new Date();
  const email = normaliseEmail(input.email);
  const fail = async (reason: string): Promise<void> => {
    await appendAuditInTransaction(pool, {
      actorType: "system",
      action: "admin.login_failed",
      targetType: "admin",
      metadata: { email, reason },
      ip: input.ip,
    });
  };

  if (
    input.ipAllowlist !== null &&
    (input.ip === null || !input.ipAllowlist.has(input.ip))
  ) {
    await fail("ip_not_allowed");
    return { ok: false, reason: "ip_not_allowed" };
  }
  const failures = await recentFailures(pool, email, now);
  if (failures.count >= failures.limit) {
    await fail("locked_out");
    return { ok: false, reason: "locked_out" };
  }

  const r = await pool.query<{
    id: string;
    password_hash: string;
    totp_secret_enc: Buffer;
    totp_key_wrapped: Buffer;
    totp_key_version: string;
    totp_last_step: string;
    status: string;
  }>(
    `select id, password_hash, totp_secret_enc, totp_key_wrapped, totp_key_version,
            totp_last_step::text as totp_last_step, status
     from public.admin_users where lower(email) = $1`,
    [email],
  );
  const admin = r.rows[0];
  // Hash even when the admin does not exist, so timing does not reveal valid emails.
  const passwordOk = await verifyPassword(
    input.password,
    admin?.password_hash ?? "scrypt$131072$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA",
  );
  if (
    admin === undefined ||
    !input.allowlist.has(email) ||
    admin.status !== "active" ||
    !passwordOk
  ) {
    await fail("credentials");
    return INVALID;
  }

  const secret = (
    await openWithWrappedKey(
      wrapper,
      admin.totp_secret_enc,
      { ciphertext: admin.totp_key_wrapped, keyVersion: admin.totp_key_version },
      totpContext(admin.id),
    )
  ).toString("utf8");

  return withTransaction(pool, async (tx) => {
    // Lock the admin row so two concurrent submissions of one code cannot both pass.
    const locked = await tx.query<{ totp_last_step: string }>(
      `select totp_last_step::text as totp_last_step from public.admin_users where id = $1 for update`,
      [admin.id],
    );
    const step = verifyTotp(
      secret,
      input.code,
      now,
      BigInt(locked.rows[0]?.totp_last_step ?? "0"),
    );
    if (step === null) {
      await appendAudit(tx, {
        actorType: "system",
        action: "admin.login_failed",
        targetType: "admin",
        targetId: admin.id,
        metadata: { email, reason: "totp" },
        ip: input.ip,
      });
      return INVALID;
    }

    const absolute = await readConfig(
      tx,
      "admin.session_absolute_seconds",
      z.number().int().positive(),
    );
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + absolute * 1000);
    await tx.query(
      `update public.admin_users set totp_last_step = $2, last_login_at = $3 where id = $1`,
      [admin.id, step.toString(), now],
    );
    await tx.query(
      `insert into public.admin_sessions (admin_id, token_hash, created_at, last_seen_at, expires_at, ip, user_agent)
       values ($1, $2, $3, $3, $4, $5, $6)`,
      [
        admin.id,
        tokenHash(token),
        now,
        expiresAt,
        input.ip,
        input.userAgent.slice(0, 500),
      ],
    );
    await appendAudit(tx, {
      actorType: "admin",
      actorId: admin.id,
      action: "admin.login",
      targetType: "admin",
      targetId: admin.id,
      ip: input.ip,
    });
    return { ok: true, token, adminId: admin.id, expiresAt };
  });
}

export interface AdminSession {
  readonly adminId: string;
  readonly email: string;
  readonly sessionId: string;
}

/** Resolve a session cookie: refuses revoked, absolute-expired and idle-expired sessions. */
export async function resolveSession(
  pool: Pool,
  token: string,
  now = new Date(),
): Promise<AdminSession | null> {
  if (token === "") return null;
  const idle = await readConfig(
    pool,
    "admin.session_idle_seconds",
    z.number().int().positive(),
  );
  const r = await pool.query<{ id: string; admin_id: string; email: string }>(
    `update public.admin_sessions s set last_seen_at = $2
     from public.admin_users a
     where s.token_hash = $1 and a.id = s.admin_id and a.status = 'active'
       and s.revoked_at is null and s.expires_at > $2 and s.last_seen_at > $3
     returning s.id, s.admin_id, a.email`,
    [tokenHash(token), now, new Date(now.getTime() - idle * 1000)],
  );
  const row = r.rows[0];
  return row === undefined
    ? null
    : { adminId: row.admin_id, email: row.email, sessionId: row.id };
}

export async function signOut(
  pool: Pool,
  token: string,
  now = new Date(),
): Promise<void> {
  const r = await pool.query<{ admin_id: string }>(
    `update public.admin_sessions set revoked_at = $2 where token_hash = $1 and revoked_at is null returning admin_id`,
    [tokenHash(token), now],
  );
  const adminId = r.rows[0]?.admin_id;
  if (adminId !== undefined) {
    await appendAuditInTransaction(pool, {
      actorType: "admin",
      actorId: adminId,
      action: "admin.logout",
      targetType: "admin",
      targetId: adminId,
    });
  }
}

/**
 * Step-up re-authentication for a sensitive admin action (R-53: break-glass grants and approvals):
 * a current TOTP code for this admin, inside the caller's transaction. Codes are single-use, the
 * same as at sign-in (`totp_last_step`), so a code seen over a shoulder cannot be replayed.
 */
export async function verifyAdminStepUp(
  tx: Queryable,
  wrapper: KeyWrapper,
  input: { adminId: string; code: string; now: Date },
): Promise<boolean> {
  const r = await tx.query<{
    totp_secret_enc: Buffer;
    totp_key_wrapped: Buffer;
    totp_key_version: string;
    totp_last_step: string;
    status: string;
  }>(
    `select totp_secret_enc, totp_key_wrapped, totp_key_version, totp_last_step::text as totp_last_step, status
     from public.admin_users where id = $1 for update`,
    [input.adminId],
  );
  const admin = r.rows[0];
  if (admin === undefined || admin.status !== "active") return false;
  const secret = (
    await openWithWrappedKey(
      wrapper,
      admin.totp_secret_enc,
      { ciphertext: admin.totp_key_wrapped, keyVersion: admin.totp_key_version },
      totpContext(input.adminId),
    )
  ).toString("utf8");
  const step = verifyTotp(
    secret,
    input.code.trim(),
    input.now,
    BigInt(admin.totp_last_step),
  );
  if (step === null) return false;
  await tx.query(`update public.admin_users set totp_last_step = $2 where id = $1`, [
    input.adminId,
    step.toString(),
  ]);
  return true;
}
