/**
 * Fixed-window rate limits in Postgres (SPEC §30): per-account limits on AI and export endpoints
 * and a per-IP ceiling on the API. One atomic upsert per request; counters for past windows are
 * pruned by a scheduled task, never on the request path. Works across serverless instances because the counter is shared.
 */

import { z } from "zod";

import { readConfig } from "./config";
import type { Queryable } from "./tx";

export const rateLimitsSchema = z.object({
  ai_per_account: z.number().int().positive(),
  chat_per_account: z.number().int().positive(),
  export_per_account: z.number().int().positive(),
  /** Downloading your own stored files. Its own bucket so it cannot throttle the chat. */
  download_per_account: z.number().int().positive().default(30),
  /**
   * Openings of one shared board (ADR 0090), counted against the link's fingerprint: each one
   * unwraps the company's key and writes a row, so a link opened in a loop is stopped here.
   */
  share_per_link: z.number().int().positive().default(60),
  /**
   * Admin sign-in attempts from one address in ten minutes (ADR 0091). Counted before the
   * password is hashed: each attempt is a scrypt at 128 MiB, so an address cycling through
   * invented emails — each under its own lockout — could otherwise exhaust the console's memory.
   */
  admin_login_per_ip: z.number().int().positive().default(20),
  /**
   * Free requests that decrypt and read a customer's whole files — counting one on arrival, and
   * looking up the names behind a chat answer's tokens — per account per minute (ADR 0091). Set
   * well above a batch's burst of arrivals; it is there for a loop.
   */
  files_per_account: z.number().int().positive().default(120),
  /** Opening a shared board, per address per minute, across every link (ADR 0091). */
  share_per_ip: z.number().int().positive().default(60),
  api_per_ip: z.number().int().positive(),
});
export type RateLimitName = keyof z.infer<typeof rateLimitsSchema>;

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** Seconds until the window resets. */
  readonly retryAfter: number;
}

/**
 * Counts one request against `name` for `subject` (an account id or an IP) in the current window.
 * Refused requests are counted too, so hammering does not reset the window.
 */
export async function consumeRateLimit(
  db: Queryable,
  name: RateLimitName,
  subject: string,
  options: { windowSeconds?: number; now?: Date } = {},
): Promise<RateLimitDecision> {
  const now = options.now ?? new Date();
  const windowSeconds = options.windowSeconds ?? 60;
  const limits = await readConfig(db, "ratelimit.limits", rateLimitsSchema, now);
  const limit = limits[name];
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const r = await db.query<{ count: number }>(
    `insert into public.rate_limit_counters (key, window_start, count) values ($1, $2, 1)
     on conflict (key, window_start) do update set count = public.rate_limit_counters.count + 1
     returning count`,
    [`${name}:${subject}`, windowStart],
  );
  const count = r.rows[0]?.count ?? 1;
  return {
    allowed: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    retryAfter: Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000),
  };
}

/** Worker: drop counters from windows that ended more than `keepSeconds` ago. */
export async function pruneRateLimits(
  db: Queryable,
  now: Date = new Date(),
  keepSeconds = 3600,
): Promise<number> {
  const r = await db.query(
    `delete from public.rate_limit_counters where window_start < $1`,
    [new Date(now.getTime() - keepSeconds * 1000)],
  );
  return r.rowCount ?? 0;
}
