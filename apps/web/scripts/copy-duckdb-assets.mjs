/**
 * Self-host DuckDB-WASM's WebAssembly binaries and worker scripts under /vendor/duckdb so the browser never loads
 * code from a third-party CDN at runtime. Copied from the installed package (pinned 1.32.0).
 */
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.dirname(require.resolve("@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm"));
const out = path.join(here, "..", "public", "vendor", "duckdb");
await mkdir(out, { recursive: true });
for (const f of [
  "duckdb-mvp.wasm",
  "duckdb-eh.wasm",
  "duckdb-browser-mvp.worker.js",
  "duckdb-browser-eh.worker.js",
])
  await copyFile(path.join(dist, f), path.join(out, f));

// The SQL guard's parser (libpg-query 17.7.4, used by @magicmis/sql-guard), for Deep chat.
const chatRequire = require;
const pgWasm = path.join(
  path.dirname(chatRequire.resolve("libpg-query")),
  "libpg-query.wasm",
);
const pgOut = path.join(here, "..", "public", "vendor", "pg");
await mkdir(pgOut, { recursive: true });
await copyFile(pgWasm, path.join(pgOut, "libpg-query.wasm"));
