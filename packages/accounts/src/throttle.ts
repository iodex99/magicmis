/**
 * Brute-force throttle (SPEC §8: rate limits and lockouts on auth endpoints).
 *
 * Counts failures per key in a fixed window. Reaching the limit locks the key until a
 * lockout expires. Success clears it. Limits come from `app_config` `auth.throttle`,
 * never from code (SPEC §0.5).
 *
 * Keys identify a subject -- `reauth:account:<uuid>`, `backup_code:ip:<addr>` -- and never
 * contain a password, code or email address, since the table is readable by operators.
 */

import { z } from "zod";

import { readConfig } from "@magicmis/db/config";
import { one, type Queryable } from "@magicmis/db/tx";

export const throttleLimitSchema = z.object({
  max_attempts: z.number().int().positive(),
  window_seconds: z.number().int().positive(),
  lockout_seconds: z.number().int().positive(),
});

export type ThrottleLimit = z.infer<typeof throttleLimitSchema>;

export const throttleConfigSchema = z.record(z.string(), throttleLimitSchema);

export type ThrottleScope =
  "reauth" | "backup_code" | "signup" | "sign_in" | "password_reset";

export async function throttleLimitFor(
  db: Queryable,
  scope: ThrottleScope,
): Promise<ThrottleLimit> {
  const config = await readConfig(db, "auth.throttle", throttleConfigSchema);
  const limit = config[scope];
  if (limit === undefined) {
    // A missing scope must fail closed. Silently skipping the throttle would remove the
    // brute-force protection the moment someone renames a key in the admin console.
    throw new Error(`auth.throttle has no limit configured for "${scope}"`);
  }
  return limit;
}

export type ThrottleState =
  | { readonly locked: false; readonly attempts: number }
  | { readonly locked: true; readonly lockedUntil: Date };

interface ThrottleRow {
  window_started_at: Date;
  attempts: number;
  locked_until: Date | null;
}

/** Whether the key is currently locked. Call before attempting the protected action. */
export async function checkThrottle(
  db: Queryable,
  key: string,
  now: Date = new Date(),
): Promise<ThrottleState> {
  const row = await one<ThrottleRow>(
    db,
    `select window_started_at, attempts, locked_until from public.auth_throttle where key = $1`,
    [key],
  );
  if (row?.locked_until != null && row.locked_until > now) {
    return { locked: true, lockedUntil: row.locked_until };
  }
  return { locked: false, attempts: row?.attempts ?? 0 };
}

/**
 * Record one failure. Must run inside a transaction: the row is locked so that
 * concurrent failures cannot both read `attempts = limit - 1` and neither lock the key.
 */
export async function registerFailure(
  tx: Queryable,
  key: string,
  limit: ThrottleLimit,
  now: Date = new Date(),
): Promise<ThrottleState> {
  await tx.query(
    `insert into public.auth_throttle (key, window_started_at, attempts, updated_at)
     values ($1, $2, 0, $2)
     on conflict (key) do nothing`,
    [key, now],
  );
  const row = await one<ThrottleRow>(
    tx,
    `select window_started_at, attempts, locked_until
     from public.auth_throttle where key = $1 for update`,
    [key],
  );
  if (row === null) throw new Error("registerFailure: throttle row vanished");

  const windowExpired =
    now.getTime() - row.window_started_at.getTime() >= limit.window_seconds * 1000;
  const lockExpired = row.locked_until !== null && row.locked_until <= now;

  const windowStart = windowExpired || lockExpired ? now : row.window_started_at;
  const attempts = (windowExpired || lockExpired ? 0 : row.attempts) + 1;
  const lockedUntil =
    attempts >= limit.max_attempts
      ? new Date(now.getTime() + limit.lockout_seconds * 1000)
      : null;

  await tx.query(
    `update public.auth_throttle
     set window_started_at = $2, attempts = $3, locked_until = $4, updated_at = $5
     where key = $1`,
    [key, windowStart, attempts, lockedUntil, now],
  );

  return lockedUntil === null
    ? { locked: false, attempts }
    : { locked: true, lockedUntil };
}

/** Clear a key after the protected action succeeds. */
export async function clearThrottle(db: Queryable, key: string): Promise<void> {
  await db.query(`delete from public.auth_throttle where key = $1`, [key]);
}
