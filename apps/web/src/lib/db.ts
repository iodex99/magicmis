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
  /*
   * Small on purpose (ADR 0054).
   *
   * On Vercel every warm function instance holds its own pool, so the connections in flight
   * are `max` × instances, not `max`. Ten each meant twenty instances could ask for two
   * hundred connections and exhaust a small Postgres, which shows up as
   * "remaining connection slots are reserved" rather than as slowness. A request handles one
   * logical operation at a time, so a handful of connections per instance is plenty; the
   * pooler is what fans them out.
   *
   * `DATABASE_POOL_MAX` raises it for any process that is not one-request-at-a-time: the worker,
   * and the single Node server that serves local development and the E2E run, where one process
   * handles every concurrent chunk of an upload (see the deployment runbook).
   */
  const configured = Number.parseInt(process.env["DATABASE_POOL_MAX"] ?? "", 10);
  pool ??= new pg.Pool({
    connectionString: serverEnv().DATABASE_URL,
    options: "-c role=service_role",
    max: Number.isInteger(configured) && configured > 0 ? configured : 5,
    idleTimeoutMillis: 30_000,
  });
  return pool;
}
