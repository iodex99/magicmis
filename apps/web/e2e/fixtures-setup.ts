/**
 * Playwright global setup: generate synthetic fixtures (SPEC §0.8: generated, never
 * committed) if they are not already in fixtures/out.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export const FIXTURES_OUT = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "fixtures",
  "out",
);

export default function globalSetup(): void {
  const run = (script: string) => {
    execSync(`pnpm --filter @magicmis/fixtures ${script}`, {
      stdio: "inherit",
      cwd: path.resolve(FIXTURES_OUT, "..", ".."),
    });
  };
  if (!existsSync(path.join(FIXTURES_OUT, "manifest.json"))) run("generate");
  if (!existsSync(path.join(FIXTURES_OUT, "perf", "large-day-book.xlsx")))
    run("generate:large");
}
