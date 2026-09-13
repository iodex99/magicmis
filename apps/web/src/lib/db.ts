import "server-only";

import pg from "pg";

import { serverEnv } from "./env";

/**
 * One pool per server process, acting as `service_role`.
 *
 * Supabase's `postgres` role has BYPASSRLS and is a member of `service_role` (checked
 * against the local stack, 2026-09-13). The role is set as a connection startup parameter
 * (`-c role=service_role`), so every query on every connection runs as `service_role` from
 * the first byte. That keeps RLS bypassed for server code -- route handlers enforce
 * tenancy with `requireAccount()` -- while the append-only revokes from migration 0011
 * bind this code too: verified that DELETE on credit_ledger is refused with "permission
 * denied" on such a connection.
 *
 * An earlier version ran `set role` in the pool's `connect` handler. pg warned that it
 * overlapped the first real query -- a race over which role that query used.
 */
let pool: pg.Pool | undefined;

export function db(): pg.Pool {
  pool ??= new pg.Pool({
    connectionString: serverEnv().DATABASE_URL,
    options: "-c role=service_role",
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  return pool;
}
