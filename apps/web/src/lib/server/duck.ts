import "server-only";

import path from "node:path";

import type * as DuckBlocking from "@duckdb/duckdb-wasm/blocking";
import type { DuckConn } from "@magicmis/ingest/duckdb";

/**
 * DuckDB for server-side jobs (ADR 0032): the Node blocking build of the same package and
 * version the engine was built and tested against, behind the async `DuckConn` interface.
 *
 * One in-memory database per job, closed when the job ends, so no job can see another's
 * tables and nothing outlives the request.
 */
// A require the bundler does not trace (Node 22 `process.getBuiltinModule`).
const require = process.getBuiltinModule("node:module").createRequire(import.meta.url);

// Loaded at runtime rather than imported: the blocking build is Emscripten output the bundler
// cannot process, and it only ever runs in Node from its own package directory.
const PACKAGE = ["@duckdb", "duckdb-wasm"].join("/");

export async function openServerDuck(): Promise<DuckConn & { close(): void }> {
  const duckdb = require(`${PACKAGE}/blocking`) as typeof DuckBlocking;
  const dist = path.dirname(require.resolve(`${PACKAGE}/dist/duckdb-mvp.wasm`));
  const db = await duckdb.createDuckDB(
    {
      mvp: {
        mainModule: path.join(dist, "duckdb-mvp.wasm"),
        mainWorker: path.join(dist, "duckdb-node-mvp.worker.cjs"),
      },
      eh: {
        mainModule: path.join(dist, "duckdb-eh.wasm"),
        mainWorker: path.join(dist, "duckdb-node-eh.worker.cjs"),
      },
    },
    new duckdb.VoidLogger(),
    duckdb.NODE_RUNTIME,
  );
  await db.instantiate();
  const conn = db.connect();
  return {
    query: (sql) =>
      Promise.resolve(
        conn
          .query(sql)
          .toArray()
          .map((row) => (row as { toJSON(): Record<string, unknown> }).toJSON()),
      ),
    registerFileText: (name, text) => {
      db.registerFileText(name, text);
      return Promise.resolve();
    },
    dropFile: (name) => {
      db.dropFile(name);
      return Promise.resolve();
    },
    close: () => {
      conn.close();
      db.reset();
    },
  };
}
