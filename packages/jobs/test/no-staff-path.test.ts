/**
 * ADR 0047 / 0048: the product tells customers, in its notices and its terms, that no member of
 * staff has a screen, tool or role that opens an uploaded file. That sentence is only true while
 * nothing staff-facing can decrypt one, so it is held here as a build failure rather than left
 * to be remembered: the admin console and the worker may not reference the things that read a
 * file's bytes. (The worker purges and sweeps; neither decrypts.)
 *
 * If this test fails, do not loosen it. Either remove the new path, or change what the product
 * says first — the privacy notice, the processing notice, the terms, the security page and Files
 * and settings — and get that wording reviewed (docs/compliance/legal-review-brief.md).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** What reads or unseals a stored file. */
const FORBIDDEN = ["loadUploadBytes", "source_chunk", "loadJobFiles", "openForCompany"];
const STAFF_FACING = ["apps/admin/src", "apps/worker/src"];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.(ts|tsx|mjs|js)$/u.test(name)) out.push(full);
  }
  return out;
}

describe("no staff-facing path opens a customer's file", () => {
  it.each(STAFF_FACING)("%s references nothing that decrypts an upload", (dir) => {
    const found: string[] = [];
    for (const file of sources(path.join(repo, dir))) {
      const text = readFileSync(file, "utf8");
      for (const word of FORBIDDEN)
        if (text.includes(word)) found.push(`${path.relative(repo, file)}: ${word}`);
    }
    expect(found).toEqual([]);
  });

  it("the read log has no purpose a person could be recorded under", () => {
    const migration = readFileSync(
      path.join(repo, "packages/db/migrations/0046_files_kept_and_chosen.sql"),
      "utf8",
    );
    const purposes = /check \(purpose in \(([^)]*)\)\)/u.exec(migration)?.[1] ?? "";
    expect(purposes.replace(/\s+/gu, "")).toBe(
      "'intake','pricing','run','chat','download'",
    );
  });
});
