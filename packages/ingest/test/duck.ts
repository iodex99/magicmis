/**
 * DuckDB-WASM for tests: the Node blocking bindings of the same package and version the
 * browser worker uses, behind the loader's async `DuckConn` interface.
 */

import { createRequire } from "node:module";
import path from "node:path";

import * as duckdb from "@duckdb/duckdb-wasm/blocking";

import type { DuckConn } from "../src/loader";

const require = createRequire(import.meta.url);

export async function openTestDuck(): Promise<DuckConn & { close(): void }> {
  const dist = path.dirname(require.resolve("@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm"));
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
    },
  };
}
