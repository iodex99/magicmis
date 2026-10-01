import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ANSWER_PATHS, PUBLIC_PAGES } from "./seo";

/**
 * Public headings are sentences, not folder names (ADR 0079). A page is skimmed for an answer,
 * by people and by the assistants that answer questions, and what gets repeated back is a
 * heading that says something: "No member of staff can open your file" is quoted, "Questions"
 * and "How it works" never are. This keeps the folder names from creeping back.
 */
const APP = path.resolve(import.meta.dirname, "..", "app");
const PRIVATE =
  /^(app|api|auth|wallet|settings|sign-|signed-out|forgot|reset|desktop|og|legal)/u;

const FOLDER_NAMES = new Set([
  "Questions",
  "Questions people ask",
  "Common questions",
  "FAQ",
  "FAQs",
  "How it works",
  "How it goes",
  "What AI does",
  "What AI does not do",
  "What it is",
  "What is on it",
  "What is in the pack",
  "What is different",
  "What changes",
  "Six steps",
  "The seven sections",
  "The eight ratios",
  "Overview",
  "Features",
  "Our approach",
  "Why choose us",
  "Guides",
]);

function pages(dir: string, rel = ""): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    const r = rel === "" ? name : `${rel}/${name}`;
    if (statSync(full).isDirectory()) return PRIVATE.test(r) ? [] : pages(full, r);
    return name === "page.tsx" ? [full] : [];
  });
}

/** Every heading a page passes as a prop, and every literal heading element. */
function headings(source: string): string[] {
  const props = [...source.matchAll(/\b(?:title|heading)="([^"]+)"/gu)].map(
    (m) => m[1] ?? "",
  );
  const literal = [...source.matchAll(/<h[1-3][^>]*>\s*([^<{]+?)\s*<\/h[1-3]>/gu)].map(
    (m) => m[1] ?? "",
  );
  return [...props, ...literal];
}

describe("public headings", () => {
  it("are sentences a reader could quote, never folder names", () => {
    const offenders = pages(APP).flatMap((file) =>
      headings(readFileSync(file, "utf8"))
        .filter((h) => FOLDER_NAMES.has(h))
        .map((h) => `${path.relative(APP, file)}: "${h}"`),
    );
    expect(offenders).toEqual([]);
  });

  it("gives every one-question page its question as the title", () => {
    for (const p of ANSWER_PATHS) {
      const page = PUBLIC_PAGES.find((x) => x.path === p);
      expect(page?.title, p).toMatch(/\?$/u);
      const source = readFileSync(path.join(APP, p.slice(1), "page.tsx"), "utf8");
      // The H1 is the same question, and the short answer comes before anything else.
      expect(source, p).toContain(`question="${page?.title ?? ""}"`);
    }
  });
});
