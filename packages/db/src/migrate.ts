/**
 * Migration runner.
 *
 * Forward-only, ordered by filename, each file applied inside its own transaction and
 * recorded with a checksum. The checksum is the point: editing a migration after it has
 * been applied means the database and the repository have silently diverged, and every
 * later environment gets a different schema. That is caught here rather than discovered
 * in production.
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Client, Pool } from "pg";

export interface Migration {
  readonly version: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface MigrationResult {
  readonly applied: string[];
  readonly skipped: string[];
}

export class MigrationChecksumError extends Error {
  constructor(version: string, expected: string, actual: string) {
    super(
      `Migration ${version} was edited after it was applied ` +
        `(recorded ${expected.slice(0, 12)}, file is ${actual.slice(0, 12)}). ` +
        `Add a new migration instead of editing an applied one.`,
    );
    this.name = "MigrationChecksumError";
  }
}

/** Default location of the SQL files, resolved relative to this module. */
export const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);

export async function loadMigrations(dir: string = MIGRATIONS_DIR): Promise<Migration[]> {
  const entries = await readdir(dir);
  const files = entries.filter((f) => f.endsWith(".sql")).sort();

  return Promise.all(
    files.map(async (file) => {
      const sql = await readFile(path.join(dir, file), "utf8");
      return {
        version: file.replace(/\.sql$/u, ""),
        sql,
        checksum: createHash("sha256").update(sql, "utf8").digest("hex"),
      };
    }),
  );
}

type Queryable = Pick<Client | Pool, "query">;

/**
 * Apply every pending migration.
 *
 * 0001 creates `app.schema_migrations`, so the bookkeeping table is created by the same
 * mechanism it tracks. The first call therefore tolerates the table not existing yet.
 */
export async function migrate(
  db: Queryable,
  dir: string = MIGRATIONS_DIR,
): Promise<MigrationResult> {
  const migrations = await loadMigrations(dir);
  const applied: string[] = [];
  const skipped: string[] = [];

  const recorded = await readApplied(db);

  for (const migration of migrations) {
    const previous = recorded.get(migration.version);
    if (previous !== undefined) {
      if (previous !== migration.checksum) {
        throw new MigrationChecksumError(migration.version, previous, migration.checksum);
      }
      skipped.push(migration.version);
      continue;
    }

    await db.query("begin");
    try {
      await db.query(migration.sql);
      await db.query(
        `insert into app.schema_migrations (version, checksum) values ($1, $2)`,
        [migration.version, migration.checksum],
      );
      await db.query("commit");
      applied.push(migration.version);
    } catch (error) {
      await db.query("rollback");
      throw new Error(
        `Migration ${migration.version} failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  return { applied, skipped };
}

async function readApplied(db: Queryable): Promise<Map<string, string>> {
  const exists = await db.query<{ present: boolean }>(
    `select to_regclass('app.schema_migrations') is not null as present`,
  );
  if (exists.rows[0]?.present !== true) return new Map();

  const result = await db.query<{ version: string; checksum: string }>(
    `select version, checksum from app.schema_migrations`,
  );
  return new Map(result.rows.map((r) => [r.version, r.checksum]));
}
