/**
 * Transactions and the minimal query surface shared by every package.
 */

import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

/** Anything that can run a parameterised query: a pool or a checked-out client. */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
}

/**
 * Run `fn` inside one transaction on one connection.
 *
 * Every wallet, auth and billing mutation goes through this. The callback receives the
 * client, never the pool, so a query cannot accidentally escape to another connection
 * and commit outside the transaction.
 */
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** First row or null, for single-row lookups. */
export async function one<R extends QueryResultRow>(
  db: Queryable,
  text: string,
  values: unknown[] = [],
): Promise<R | null> {
  const result = await db.query<R>(text, values);
  return result.rows[0] ?? null;
}
