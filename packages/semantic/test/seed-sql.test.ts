import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { seedSql } from "../src/seed-sql";

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe("migration 0020", () => {
  it("embeds the seed generated from the TypeScript heads and library, verbatim", async () => {
    const sql = await readFile(
      path.join(HERE, "../../db/migrations/0020_semantic_seed.sql"),
      "utf8",
    );
    expect(sql.replace(/\r\n/gu, "\n")).toContain(seedSql());
  });
});
