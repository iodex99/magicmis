#!/usr/bin/env node
/**
 * Mirror packages/db/migrations into supabase/migrations.
 *
 * packages/db is the single source of truth for the schema: the Testcontainers suites and
 * the migration runner read it directly. The Supabase CLI instead expects
 * `supabase/migrations/<14-digit timestamp>_<name>.sql`. This script copies each file
 * across with a deterministic timestamp derived from its sequence number, so the two
 * never drift and the order is identical.
 *
 * Run with `--check` in CI to fail if the mirror is stale.
 */

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "packages", "db", "migrations");
const target = path.join(root, "supabase", "migrations");
const check = process.argv.includes("--check");

// 0001_identity.sql -> 20260101000001_identity.sql. The base date is arbitrary but fixed;
// only ordering matters to the CLI.
const BASE = 20260101000000n;

const toTarget = (file) => {
  const match = /^(\d{4})_(.+\.sql)$/u.exec(file);
  if (!match) throw new Error(`Unexpected migration name: ${file}`);
  return `${String(BASE + BigInt(match[1]))}_${match[2]}`;
};

const sha = (s) => createHash("sha256").update(s).digest("hex");

const files = (await readdir(source)).filter((f) => f.endsWith(".sql")).sort();
await mkdir(target, { recursive: true });
const existing = new Set((await readdir(target)).filter((f) => f.endsWith(".sql")));

const expected = new Map();
for (const file of files) {
  const body = await readFile(path.join(source, file), "utf8");
  expected.set(
    toTarget(file),
    `-- GENERATED from packages/db/migrations/${file}. Do not edit.\n${body}`,
  );
}

let stale = 0;
for (const [name, body] of expected) {
  const current = existing.has(name)
    ? await readFile(path.join(target, name), "utf8")
    : null;
  if (current !== null && sha(current) === sha(body)) continue;
  stale++;
  if (!check) await writeFile(path.join(target, name), body);
}
for (const name of existing) {
  if (expected.has(name)) continue;
  stale++;
  if (!check) await rm(path.join(target, name));
}

if (check && stale > 0) {
  console.error(
    `supabase/migrations is stale (${String(stale)} file(s)). Run: node scripts/sync-supabase-migrations.mjs`,
  );
  process.exit(1);
}
console.log(
  check
    ? "supabase/migrations is in sync."
    : `Synced ${String(expected.size)} migration(s); ${String(stale)} changed.`,
);
