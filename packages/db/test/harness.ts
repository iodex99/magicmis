/**
 * Testcontainers Postgres harness.
 *
 * Boots a real Postgres, applies the auth shim and every migration, and hands back a
 * pool plus helpers for acting as a specific tenant.
 *
 * A mock cannot prove RLS isolation -- the whole question is what the *database* does
 * with a policy under a given role, so the tests run against the real thing.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import pg from "pg";

import { migrate } from "../src/migrate";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export type DbRole = "anon" | "authenticated" | "service_role";

export interface TestDb {
  readonly pool: pg.Pool;
  readonly container: StartedPostgreSqlContainer;
  stop: () => Promise<void>;
  /**
   * Run `fn` on a connection acting as `role` with the given auth user id, exactly as a
   * PostgREST request would. Settings are LOCAL to a transaction that is always rolled
   * back, so no test can leak state or a role into another.
   *
   * By default a known user acts at `aal2` on their account's active session, which is
   * what an ordinary authenticated request is after Phase 1. Pass `claims` to override
   * `aal` or `session_id` and test the refusals.
   */
  asUser: <T>(
    authUserId: string | null,
    role: DbRole,
    fn: (client: pg.PoolClient) => Promise<T>,
    claims?: Record<string, string>,
  ) => Promise<T>;
}

export async function startTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("magicmis_test")
    .withUsername("postgres")
    .withPassword("postgres")
    .start();

  const pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 12 });

  const shim = await readFile(path.join(HERE, "auth-shim.sql"), "utf8");
  await pool.query(shim);
  await migrate(pool);

  const asUser: TestDb["asUser"] = async (authUserId, role, fn, overrides = {}) => {
    let claims: Record<string, string> = {};
    if (authUserId !== null) {
      const session = await pool.query<{ active_session_id: string | null }>(
        "select active_session_id from public.accounts where auth_user_id = $1",
        [authUserId],
      );
      const sessionId = session.rows[0]?.active_session_id ?? null;
      claims = {
        sub: authUserId,
        role,
        aal: "aal2",
        ...(sessionId === null ? {} : { session_id: sessionId }),
      };
    }
    claims = { ...claims, ...overrides };

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(claims),
      ]);
      await client.query(`set local role ${role}`);
      return await fn(client);
    } finally {
      // Always roll back: these connections are for observing policy behaviour.
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  };

  return {
    pool,
    container,
    asUser,
    stop: async () => {
      await pool.end();
      await container.stop();
    },
  };
}

export interface SeededAccount {
  readonly accountId: string;
  readonly authUserId: string;
  readonly companyId: string;
  readonly sessionId: string;
}

/**
 * Seed two complete, independent tenants.
 *
 * Both get the same-shaped data so a cross-tenant read would return something
 * plausible rather than obviously wrong -- which is the case a weak test misses.
 */
export async function seedTwoAccounts(
  pool: pg.Pool,
): Promise<[SeededAccount, SeededAccount]> {
  const seed = async (label: string, stateCode: string): Promise<SeededAccount> => {
    const account = await pool.query<{
      id: string;
      auth_user_id: string;
      active_session_id: string;
    }>(
      `insert into public.accounts
         (auth_user_id, email, business_name, state_code, active_session_id)
       values (gen_random_uuid(), $1, $2, $3, gen_random_uuid())
       returning id, auth_user_id, active_session_id`,
      [`${label}@example.test`, `${label} Advisors LLP`, stateCode],
    );
    const row = account.rows[0];
    if (row === undefined) throw new Error("seed: account insert returned nothing");

    await pool.query(
      `insert into public.wallets (account_id, balance_credits, held_credits)
       values ($1, 5000, 0)`,
      [row.id],
    );

    const company = await pool.query<{ id: string }>(
      `insert into public.companies (account_id, name)
       values ($1, $2) returning id`,
      [row.id, `${label} Trading Pvt Ltd`],
    );
    const companyRow = company.rows[0];
    if (companyRow === undefined) {
      throw new Error("seed: company insert returned nothing");
    }

    await pool.query(
      `insert into public.snapshots
         (company_id, account_id, period, version, ledger_balances, metric_store, engine_version)
       values ($1, $2, '2025-04', 1, '\\x00'::bytea, '\\x00'::bytea, 'test')`,
      [companyRow.id, row.id],
    );

    return {
      accountId: row.id,
      authUserId: row.auth_user_id,
      companyId: companyRow.id,
      sessionId: row.active_session_id,
    };
  };

  return [await seed("alpha", "27"), await seed("beta", "29")];
}
