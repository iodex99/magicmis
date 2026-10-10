import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Before launch every door into an account is shut (ADR 0078). The likely way that stops being
 * true is a new auth route written later without the check, so this reads them all: each one
 * that can create, claim or recover a session must ask `prelaunch()` first.
 */
const APP = path.resolve(import.meta.dirname, "..", "app");

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routes(full);
    return name === "route.ts" ? [full] : [];
  });
}

describe("pre-launch", () => {
  it("guards every auth route except signing out", () => {
    const files = [
      ...routes(path.join(APP, "api", "auth")),
      ...routes(path.join(APP, "auth")),
    ].filter((f) => !f.includes(`${path.sep}sign-out${path.sep}`));
    expect(files.length).toBeGreaterThanOrEqual(7);
    const unguarded = files
      .filter((f) => !readFileSync(f, "utf8").includes("if (prelaunch())"))
      .map((f) => path.relative(APP, f));
    expect(unguarded).toEqual([]);
  });

  it("shows the sign-up, sign-in and password pages as opening soon", () => {
    for (const page of [
      ["sign-up", "page.tsx"],
      ["sign-in", "page.tsx"],
      ["sign-up", "finish", "page.tsx"],
      // A form whose only answer is "not open yet" is a dead end (ADR 0091).
      ["forgot-password", "page.tsx"],
      ["reset-password", "page.tsx"],
    ])
      expect(readFileSync(path.join(APP, ...page), "utf8")).toContain(
        "if (prelaunch()) return <OpeningSoon />;",
      );
  });
});
