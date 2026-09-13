/**
 * Write the synthetic fixture set to fixtures/out (gitignored; SPEC §0.8: fixtures are
 * generated, never committed).
 *
 *   pnpm --filter @magicmis/fixtures generate
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildFixtureSet } from "../src/fixtures";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "out");

const set = buildFixtureSet();
const json = (v: unknown) =>
  JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? x.toString() : x), 2);

for (const f of set.files) {
  const target = path.join(OUT, f.name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, f.bytes());
}
for (const t of set.truths) {
  await writeFile(path.join(OUT, t.company, "ground-truth.json"), json(t));
}
await writeFile(
  path.join(OUT, "manifest.json"),
  json(
    set.files.map((f) => ({
      company: f.company,
      name: f.name,
      format: f.format,
      report: f.report,
      period: f.period,
      variant: f.variant,
      quirks: f.quirks,
      broken: f.broken ?? null,
      truth: f.truth,
    })),
  ),
);
console.warn(
  `Wrote ${set.files.length.toString()} files for ${set.truths.length.toString()} companies to ${OUT}`,
);
