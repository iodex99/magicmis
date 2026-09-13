/**
 * SQL for the canonical heads and the global library seed, generated from the TypeScript source
 * of truth. Migration 0020 embeds this block verbatim; `test/seed-sql.test.ts` fails if they drift.
 */

import { CANONICAL_HEADS, HEADS_VERSION } from "./heads";
import { GLOBAL_LIBRARY_SEED } from "./library";

const lit = (s: string | null): string =>
  s === null ? "null" : `'${s.replace(/'/gu, "''")}'`;

export const SEED_BEGIN = "-- BEGIN GENERATED SEED (packages/semantic seed-sql)";
export const SEED_END = "-- END GENERATED SEED";

export function seedSql(): string {
  const lines: string[] = [SEED_BEGIN];
  for (const h of CANONICAL_HEADS) {
    if (h.code === "UNMAPPED") {
      lines.push(
        `update public.mis_heads set class = 'memo', version = ${HEADS_VERSION.toString()} where code = 'UNMAPPED';`,
      );
      continue;
    }
    const parent =
      h.parent === null
        ? "null"
        : `(select id from public.mis_heads where code = ${lit(h.parent)})`;
    lines.push(
      `insert into public.mis_heads (parent_id, code, name, statement, schedule_iii_ref, normal_balance, class, sort_order, version) values (${parent}, ${lit(h.code)}, ${lit(h.name)}, ${lit(h.statement)}, ${lit(h.scheduleIII)}, ${lit(h.normalBalance)}, ${lit(h.class)}, ${h.sortOrder.toString()}, ${HEADS_VERSION.toString()}) on conflict (code) do nothing;`,
    );
  }
  for (const e of GLOBAL_LIBRARY_SEED) {
    const aliases = `array[${e.aliases.map(lit).join(", ")}]::text[]`;
    lines.push(
      `insert into public.global_mapping_library (normalized_name, aliases, mis_head_id, source) values (${lit(e.name)}, ${aliases}, (select id from public.mis_heads where code = ${lit(e.head)}), 'seed') on conflict (normalized_name) do nothing;`,
    );
  }
  lines.push(SEED_END);
  return lines.join("\n");
}
