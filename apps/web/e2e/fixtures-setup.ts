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

  // Every E2E account signs up from 127.0.0.1; the throttle itself is covered by unit tests.
  const pool = new pg.Pool({ connectionString: LOCAL_DB, max: 1 });
  try {
    await pool.query(`delete from auth_throttle where key like 'signup:ip:%'`);
  } finally {
    await pool.end();
  }
}
