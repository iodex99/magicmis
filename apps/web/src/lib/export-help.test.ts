import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { EXPORT_HELP } from "./export-help";

const APP = path.join(import.meta.dirname, "..", "app");

describe("which file to export, in the app (ADR 0087)", () => {
  it("links every system to a public guide that exists", () => {
    for (const h of EXPORT_HELP)
      expect(
        existsSync(path.join(APP, ...h.guide.split("/").filter(Boolean), "page.tsx")),
        h.guide,
      ).toBe(true);
  });

  it("starts with the systems sold everywhere and ends with any other", () => {
    expect(EXPORT_HELP.at(-1)?.id).toBe("other");
    expect(new Set(EXPORT_HELP.map((h) => h.id)).size).toBe(EXPORT_HELP.length);
  });
});
