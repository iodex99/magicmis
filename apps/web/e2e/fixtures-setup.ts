/**
 * Playwright global setup: generate synthetic fixtures (SPEC §0.8: generated, never
 * committed) if they are not already in fixtures/out, and reset the local stack's sign-up
 * throttle so repeated local runs are not refused by the product's own per-IP limit.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import pg from "pg";

export const FIXTURES_OUT = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "fixtures",
  "out",
);

// The local Supabase stack's database (supabase/config.toml defaults; not a secret).
const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export default async function globalSetup(): Promise<void> {
  const run = (script: string) => {
    execSync(`pnpm --filter @magicmis/fixtures ${script}`, {
      stdio: "inherit",
      cwd: path.resolve(FIXTURES_OUT, "..", ".."),
    });
  };
  if (!existsSync(path.join(FIXTURES_OUT, "manifest.json"))) run("generate");
  if (!existsSync(path.join(FIXTURES_OUT, "perf", "large-day-book.xlsx")))
    run("generate:large");

  // Every request in the suite comes from 127.0.0.1, which is exactly the shape the
  // sign-up throttle and the per-IP API limit exist to refuse. Both are covered by unit
  // tests; here they would only refuse the suite for being a suite.
  const pool = new pg.Pool({ connectionString: LOCAL_DB, max: 1 });
  try {
    await pool.query(`delete from auth_throttle where key like 'signup:ip:%'`);
    await pool.query(`delete from rate_limit_counters`);
  } finally {
    await pool.end();
  }
}
