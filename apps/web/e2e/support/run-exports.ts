/**
 * One tick of the worker's `privacy-exports` task against the local stack, for E2E. Runs under
 * `tsx --conditions=react-server` like the worker, because the engine's server module is server-only.
 * Prints the tick result as JSON.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { LocalKeyWrapper } from "@magicmis/crypto";
import { processAccountExports, type OutputStore } from "@magicmis/jobs";
import pg from "pg";

const [databaseUrl, masterKey, outputRoot] = process.argv.slice(2);
if (databaseUrl === undefined || masterKey === undefined || outputRoot === undefined)
  throw new Error("usage: run-exports <database-url> <master-key-base64> <output-root>");

const store: OutputStore = {
  async put(p, bytes) {
    const f = path.join(outputRoot, p);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, bytes, { flag: "wx" });
  },
  get: (p) => readFile(path.join(outputRoot, p)),
  async remove(paths) {
    for (const p of paths) await rm(path.join(outputRoot, p), { force: true });
  },
};

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
try {
  const result = await processAccountExports(
    pool,
    LocalKeyWrapper.fromBase64(masterKey),
    store,
  );
  process.stdout.write(JSON.stringify(result));
} finally {
  await pool.end();
}
