/**
 * Every link an email sends a customer to is a page that exists (ADR 0086).
 *
 * Five emails — the run finished, the run failed, a quote is waiting, the monthly reminder, a
 * company archived — linked to pages that had never been built or had moved, and each opened
 * "not found". They are the emails that bring a customer back, and nothing checked them: the
 * worker builds the link, the web app serves the page, and no test looked at both.
 *
 * This reads every `path:` in the worker's templates, turns each `${...}` into a dynamic segment,
 * and requires a page for it under `src/app`.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const APP = path.resolve(import.meta.dirname, "..", "app");
const TEMPLATES = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "worker",
  "src",
  "templates.ts",
);

/** Does `/a/b/c` resolve to a page, letting any segment be a `[param]` folder? */
function pageExists(dir: string, segments: readonly string[]): boolean {
  if (segments.length === 0) return existsSync(path.join(dir, "page.tsx"));
  const [head = "", ...rest] = segments;
  const candidates = head.startsWith(":")
    ? readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^\[[^.\]]+\]$/u.test(d.name))
        .map((d) => d.name)
    : [head];
  return candidates.some(
    (c) => existsSync(path.join(dir, c)) && pageExists(path.join(dir, c), rest),
  );
}

const links = [
  ...readFileSync(TEMPLATES, "utf8").matchAll(/path:\s*[`"]([^`"]+)[`"]/gu),
].map((m) => m[1] ?? "");

describe("email links", () => {
  it("finds the links it is meant to check", () => {
    expect(links.length).toBeGreaterThanOrEqual(8);
  });

  it.each([...new Set(links)])("%s is a page the app serves", (link) => {
    const segments = link
      .split("?")[0]
      ?.split("/")
      .filter((s) => s !== "")
      .map((s) => (s.includes("${") ? ":param" : s));
    expect(pageExists(APP, segments ?? [])).toBe(true);
  });
});
