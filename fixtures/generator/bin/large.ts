/**
 * Write the ~50 MB performance workbook (SPEC §33) to fixtures/out/perf/large-day-book.xlsx.
 *
 *   pnpm --filter @magicmis/fixtures generate:large
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { largeDayBookXlsx } from "../src/large";

const out = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "out",
  "perf",
);
await mkdir(out, { recursive: true });
const bytes = largeDayBookXlsx(
  Number.parseInt(process.env["LARGE_ROWS"] ?? "370000", 10),
);
await writeFile(path.join(out, "large-day-book.xlsx"), bytes);
console.warn(`Wrote ${(bytes.length / 1048576).toFixed(1)} MB`);
