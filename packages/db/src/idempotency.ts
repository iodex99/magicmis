/**
 * Idempotency-Key handling for mutating endpoints (SPEC §4).
 */

import { createHash } from "node:crypto";

import { canonicalise, type ChainValue } from "@magicmis/core/hashchain";
import { z } from "zod";

import { readConfig } from "./config";
import { one, type Queryable } from "./tx";

export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9_.:-]+$/u);

export type BeginResult =
  | { readonly state: "new" }
  | { readonly state: "replay"; readonly status: number; readonly body: unknown }
  /** Completed, but the response held a secret and was deliberately not stored. */
  | { readonly state: "replay_refused" }
  /** Same key, different request body. */
  | { readonly state: "conflict" }
  /** The first request with this key is still running. */
  | { readonly state: "in_progress" };

export function requestHash(body: ChainValue): string {
  return createHash("sha256").update(canonicalise(body)).digest("hex");
}

/**
 * Claim a key before doing the work. Exactly one concurrent caller gets `new`; the rest
 * see `in_progress`, or the stored outcome once it completes.
 */
export async function beginIdempotent(
  db: Queryable,
  scope: string,
  key: string,
  hash: string,
  now: Date = new Date(),
): Promise<BeginResult> {
  const inserted = await db.query(
    `insert into public.idempotency_keys (scope, key, request_hash, created_at)
     values ($1, $2, $3, $4)
     on conflict (scope, key) do nothing`,
    [scope, key, hash, now],
  );
  if (inserted.rowCount === 1) return { state: "new" };

  const row = await one<{
    request_hash: string;
    status: string;
    response_status: number | null;
    response_body: unknown;
    body_stored: boolean;
    created_at: Date;
  }>(
    db,
    `select request_hash, status, response_status, response_body, body_stored, created_at
     from public.idempotency_keys where scope = $1 and key = $2`,
    [scope, key],
  );
  if (row === null) return beginIdempotent(db, scope, key, hash, now); // raced a purge

  if (row.request_hash !== hash) return { state: "conflict" };

  if (row.status === "in_progress") {
    const staleSeconds = await readConfig(
      db,
      "api.idempotency_stale_seconds",
      z.number().int().positive(),
    );
    const abandoned = now.getTime() - row.created_at.getTime() > staleSeconds * 1000;
    if (!abandoned) return { state: "in_progress" };
    // Take over an abandoned claim atomically, so two retries cannot both win it.
    const takeover = await db.query(
      `update public.idempotency_keys set created_at = $3
       where scope = $1 and key = $2 and status = 'in_progress' and created_at = $4`,
      [scope, key, now, row.created_at],
    );
    return takeover.rowCount === 1 ? { state: "new" } : { state: "in_progress" };
  }

  if (!row.body_stored) return { state: "replay_refused" };
  return { state: "replay", status: row.response_status ?? 200, body: row.response_body };
}

export async function completeIdempotent(
  db: Queryable,
  scope: string,
  key: string,
  response: { status: number; body: unknown; containsSecret?: boolean },
  now: Date = new Date(),
): Promise<void> {
  const store = response.containsSecret !== true;
  await db.query(
    `update public.idempotency_keys
     set status = 'completed', response_status = $3, response_body = $4,
         body_stored = $5, completed_at = $6
     where scope = $1 and key = $2`,
    [
      scope,
      key,
      response.status,
      store ? JSON.stringify(response.body) : null,
      store,
      now,
    ],
  );
}

/** Release a claim when the work failed before producing a response worth replaying. */
export async function abandonIdempotent(
  db: Queryable,
  scope: string,
  key: string,
): Promise<void> {
  await db.query(
    `delete from public.idempotency_keys where scope = $1 and key = $2 and status = 'in_progress'`,
    [scope, key],
  );
}
