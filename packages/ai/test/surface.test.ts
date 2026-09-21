/**
 * SPEC §2.9, §7, §34 Phase 4 acceptance: no generic prompt passthrough exists.
 *
 *  - The package index exports only purpose-named AI functions; nothing whose name or parameters
 *    suggest forwarding a prompt, or choosing a model, effort or token limit.
 *  - The stage input schemas reject those fields.
 *  - No browser-side code imports `@magicmis/ai`, and the index carries the `server-only` marker.
 *  - Nothing outside packages/ai constructs an Anthropic client.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as ai from "../src/index";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const AI_CALLING_EXPORTS = new Set([
  "classifySheets",
  "mapColumns",
  "mapLedgers",
  "generateCommentary",
  "extractReferenceLayout",
  "chatQuick",
  "chatEditSpec",
  "proposeDashboardLayout",
  "chatDeepStep",
  "summariseThread",
]);
const OTHER_FUNCTION_EXPORTS = new Set([
  "jobAiContext",
  "runJobAiStage",
  "syncJobAiCost",
  "anthropicTransport",
  "activatePromptVersion",
  "recordEvalRun",
  "chatAiContext",
  "editOperations",
  "specFromLayout",
]);
const FORBIDDEN_NAME =
  /prompt(?!Version)|passthrough|complete|send|raw|generic|message/iu;

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".turbo", "dist", "out", "public"].includes(e.name))
      continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (/\.(ts|tsx|mts|js|mjs)$/u.test(e.name)) out.push(p);
  }
  return out;
}

describe("public surface", () => {
  it("exports only purpose-named AI functions", () => {
    const fns = Object.entries(ai)
      .filter(([, v]) => typeof v === "function" && !/^[A-Z]/u.test(v.name || "x"))
      .map(([k]) => k);
    for (const name of fns) {
      expect(
        AI_CALLING_EXPORTS.has(name) || OTHER_FUNCTION_EXPORTS.has(name),
        `unexpected function export ${name}`,
      ).toBe(true);
    }
    for (const name of Object.keys(ai)) {
      if (name === "activatePromptVersion") continue; // eval gate, takes a version number only
      expect(FORBIDDEN_NAME.test(name), `export ${name} looks like a passthrough`).toBe(
        false,
      );
    }
    expect(Object.keys(ai)).not.toContain("runStage");
    expect(Object.keys(ai)).not.toContain("recordCall");
  });

  it("stage functions take (context, input) and inputs reject model, prompt, effort and max_tokens", () => {
    for (const name of AI_CALLING_EXPORTS) {
      const fn = (ai as unknown as Record<string, (...args: unknown[]) => unknown>)[name];
      expect(fn?.length).toBe(2);
    }
    const extra = {
      model: "claude-fable-5-1",
      system: "x",
      prompt: "x",
      effort: "max",
      max_tokens: 1,
    };
    for (const schema of [
      ai.classifySheetsInput,
      ai.mapColumnsInput,
      ai.mapLedgersInput,
    ]) {
      const shape = Object.keys(schema.shape);
      for (const k of Object.keys(extra)) expect(shape).not.toContain(k);
    }
  });

  it("the index is marked server-only", async () => {
    const src = await readFile(path.join(ROOT, "packages/ai/src/index.ts"), "utf8");
    expect(src).toMatch(/^import "server-only";$/mu);
  });
});

describe("import guard", () => {
  it("no browser-side package or client component imports @magicmis/ai", async () => {
    const offenders: string[] = [];
    const browserPackages = ["ingest", "redact", "tally", "ui", "core"].map((p) =>
      path.join(ROOT, "packages", p),
    );
    for (const dir of browserPackages) {
      for (const f of await walk(dir).catch(() => [])) {
        if (/@magicmis\/ai\b/u.test(await readFile(f, "utf8"))) offenders.push(f);
      }
    }
    for (const app of ["web", "admin"]) {
      for (const f of await walk(path.join(ROOT, "apps", app, "src")).catch(() => [])) {
        const src = await readFile(f, "utf8");
        const isClient = /^\s*["']use client["']/u.test(src) || f.endsWith(".worker.ts");
        if (isClient && /@magicmis\/ai\b|@anthropic-ai\/sdk/u.test(src))
          offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("only packages/ai constructs an Anthropic client", async () => {
    const offenders: string[] = [];
    for (const top of ["apps", "packages"]) {
      for (const f of await walk(path.join(ROOT, top))) {
        if (f.includes(`${path.sep}packages${path.sep}ai${path.sep}`)) continue;
        if (/@anthropic-ai\/sdk/u.test(await readFile(f, "utf8"))) offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });
});
