/**
 * Versioned business config (SPEC §0.5, §4, §9 `app_config`).
 *
 * The row in effect is the highest version whose `effective_from` is not in the future.
 * Values are Zod-validated on read: config is a boundary like any other, and a malformed
 * admin edit must fail loudly rather than flow into pricing or auth as `undefined`.
 */

import type { z } from "zod";

import { type Queryable } from "./tx.js";

export class ConfigMissingError extends Error {
  constructor(readonly key: string) {
    super(`app_config has no effective value for "${key}"`);
    this.name = "ConfigMissingError";
  }
}

export class ConfigInvalidError extends Error {
  constructor(
    readonly key: string,
    readonly issues: string,
  ) {
    super(`app_config value for "${key}" failed validation: ${issues}`);
    this.name = "ConfigInvalidError";
  }
}

export async function readConfig<S extends z.ZodType>(
  db: Queryable,
  key: string,
  schema: S,
  at: Date = new Date(),
): Promise<z.infer<S>> {
  const result = await db.query<{ value: unknown }>(
    `select value from public.app_config
     where key = $1 and effective_from <= $2
     order by version desc
     limit 1`,
    [key, at],
  );
  const row = result.rows[0];
  if (row === undefined) throw new ConfigMissingError(key);

  const parsed = schema.safeParse(row.value);
  if (!parsed.success) {
    throw new ConfigInvalidError(
      key,
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }
  return parsed.data;
}
