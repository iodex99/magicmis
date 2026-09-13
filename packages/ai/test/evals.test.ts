/**
 * SPEC §34 Phase 4 acceptance: evals run and report. CI runs replay mode (oracle recordings, no
 * network) through the production orchestrator; live runs need AI_LIVE=1 and a key (R-28).
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { activatePromptVersion } from "../src/activation";
import {
  columnMappingDataset,
  referenceLayoutDataset,
  sheetClassificationDataset,
} from "../evals/datasets";
import { runEval, type Recording } from "../evals/harness";

let db: TestDb | undefined;
beforeAll(async () => {
  db = await startTestDb();
}, 180_000);
afterAll(async () => {
  await db?.stop();
});
const pool = () => {
  if (db === undefined) throw new Error("test database was not started");
  return db.pool;
};

describe("datasets", () => {
  it("builds labelled items from the synthetic fixtures across report types", () => {
    const sc = sheetClassificationDataset(60);
    expect(sc.length).toBeGreaterThanOrEqual(12);
    expect(new Set(sc.map((i) => i.label)).size).toBeGreaterThanOrEqual(10);
    for (const item of sc) {
      expect(item.input.sheets[0]?.name).toBe("Sheet1");
      expect(item.input.sheets[0]?.titleLines).toEqual([]);
    }
    const cm = columnMappingDataset(20);
    expect(cm.some((i) => Object.values(i.label).includes("particulars"))).toBe(true);
  });
});

describe("harness", () => {
  it("runs in replay mode without activation, scores, records and reports", async () => {
    const report = await runEval({
      pool: pool(),
      stage: "sheet_classification",
      tier: "efficient",
      promptVersion: 1,
      mode: "replay",
      limit: 20,
    });
    expect(report.oracle).toBe(true);
    expect(report.failures).toEqual([]);
    expect(report.accuracy).toBe("1.0000");
    const run = await pool().query(
      `select mode, accuracy::text from ai_eval_runs where id = $1`,
      [report.evalRunId],
    );
    expect(run.rows[0]).toEqual({ mode: "replay", accuracy: "1.0000" });

    // A replay never activates a prompt version.
    await expect(
      activatePromptVersion(pool(), {
        stage: "sheet_classification",
        tier: "efficient",
        promptVersion: 1,
        actorAdminId: null,
      }),
    ).rejects.toMatchObject({ code: "no_eval" });
  });

  it("scores column mapping per column and reports mismatches from a recording", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ai-evals-"));
    const recordingPath = path.join(dir, "rec.json");
    // A recording with nothing matching: every item fails and is reported, nothing crashes.
    const rec: Recording = { nope: { text: "{}", model: "x", usage: {} as never } };
    await writeFile(recordingPath, JSON.stringify(rec));
    const report = await runEval({
      pool: pool(),
      stage: "column_mapping",
      tier: "efficient",
      promptVersion: 1,
      mode: "replay",
      limit: 3,
      recordingPath,
    });
    expect(report.oracle).toBe(false);
    expect(report.correct).toBe(0);
    expect(report.failures).toHaveLength(3);
  });

  it.each(["reference_layout", "commentary"] as const)(
    "%s: the dataset runs through the stage check and scores in replay",
    async (stage) => {
      const report = await runEval({
        pool: pool(),
        stage,
        tier: "professional",
        promptVersion: 1,
        mode: "replay",
      });
      expect(report.oracle).toBe(true);
      expect(report.failures).toEqual([]);
      expect(report.accuracy).toBe("1.0000");
    },
  );
});

describe("reference layout dataset", () => {
  it("labels only rows the rules leave unbound, including relabelled wording", () => {
    const items = referenceLayoutDataset();
    expect(items.length).toBeGreaterThanOrEqual(10);
    const base = items.find((i) => i.id === "rl-base");
    expect(Object.values(base?.label ?? {}).sort()).toEqual([
      "employee_cost",
      "subtotal",
      "unavailable",
      "unavailable",
    ]);
    const all = items.find((i) => i.id === "rl-all-relabelled");
    expect(Object.values(all?.label ?? {})).toEqual(
      expect.arrayContaining(["revenue", "receivables", "inventory", "finance_cost"]),
    );
  });
});
