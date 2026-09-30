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
import {
  DEEP_FUZZY_THRESHOLD,
  DEEP_FY_START_MONTH,
  deepBooks,
  deepDataset,
  runDeepEval,
  scoreDeep,
} from "../evals/deep";
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

  it.each([
    ["efficient", "0.9895"],
    ["professional", "0.9791"],
    ["expert", "1.0000"],
  ] as const)(
    "ledger_mapping %s: the committed live recording still scores what it was activated on (ADR 0069)",
    async (tier, accuracy) => {
      // The recordings are the evidence the activation rests on. Replaying them costs nothing, so
      // a change to the dataset, the scorer or the prompt input that would alter the score shows
      // here rather than at the next live run.
      const report = await runEval({
        pool: pool(),
        stage: "ledger_mapping",
        tier,
        promptVersion: 1,
        mode: "replay",
        recordingPath: path.join(
          import.meta.dirname,
          "..",
          "evals",
          "recordings",
          `ledger_mapping-v1-${tier}.json`,
        ),
      });
      expect(report.oracle).toBe(false);
      expect(report.items).toBe(96);
      expect(report.accuracy).toBe(accuracy);
    },
  );

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

  it.each([
    "ledger_mapping",
    "reference_layout",
    "commentary",
    "chat_quick",
    "chat_edit",
    "thread_summary",
    "board_actions",
    "dashboard_layout",
  ] as const)(
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

  it("chat_deep: every item is answered through the real guard and DuckDB, and scores (R-44)", async () => {
    // The oracle asks each item's own query, which runs through `guardSql` and `runChatQuery`
    // over the synthetic books, and answers citing its cells. Every expected value was computed
    // from the ledgers without SQL, so a perfect oracle score means each one is reachable, the
    // books are shaped as production shapes them, and the scorer agrees with the check.
    const report = await runDeepEval({
      pool: pool(),
      tier: "professional",
      promptVersion: 1,
      mode: "replay",
    });
    expect(report.oracle).toBe(true);
    expect(report.failures).toEqual([]);
    expect(report.items).toBeGreaterThanOrEqual(50);
    expect(report.accuracy).toBe("1.0000");
  }, 120_000);
});

describe("chat_deep dataset", () => {
  it("scores an answer by what the customer would see", () => {
    const steps = [
      { ref: "q1", columns: ["rent_paise", "customers"], rows: [["4500000", "3"]] },
      { ref: "q2", columns: ["rent_rupees"], rows: [["45000.00"]] },
    ];
    const money = {
      scope: "in_scope" as const,
      expect: [{ kind: "money" as const, paise: "4500000" }],
    };
    const say = (text: string) => ({
      scope: "in_scope" as const,
      paragraphs: [{ text }],
    });
    expect(scoreDeep(say("Rent was {{q:q1:0:rent_paise}}."), steps, money)).toBe(true);
    // Divided into rupees the cell is shown raw, not as money: the customer reads "45000.00".
    expect(scoreDeep(say("Rent was {{q:q2:0:rent_rupees}}."), steps, money)).toBe(false);
    // A count under a money-looking name would be shown as money, so it does not count.
    const count = {
      scope: "in_scope" as const,
      expect: [{ kind: "count" as const, n: "3" }],
    };
    expect(scoreDeep(say("{{q:q1:0:customers}} customers."), steps, count)).toBe(true);
    // The same three under `total`, which the page would show as money: cited, and refused.
    expect(
      scoreDeep(
        say("{{q:q1:0:total}} customers."),
        [{ ref: "q1", columns: ["total"], rows: [["3"]] }],
        count,
      ),
    ).toBe(false);
    // The amount with the wrong sign is a different figure to the reader: sales in brackets.
    const negative = [{ ref: "q1", columns: ["rent_paise"], rows: [["-4500000"]] }];
    expect(scoreDeep(say("Rent was {{q:q1:0:rent_paise}}."), negative, money)).toBe(
      false,
    );
    // The right figure in the wrong scope is still wrong.
    expect(
      scoreDeep({ scope: "out_of_scope", paragraphs: [{ text: "No." }] }, steps, money),
    ).toBe(false);
    // A question the books cannot answer: saying so passes, citing an amount does not.
    const unanswerable = { scope: "in_scope" as const, expect: [] };
    expect(scoreDeep(say("The books do not show this."), steps, unanswerable)).toBe(true);
    expect(scoreDeep(say("It was {{q:q1:0:rent_paise}}."), steps, unanswerable)).toBe(
      false,
    );
  });

  it("asks for a month where no year-to-date balance could pass for it", () => {
    // The first rent item asked for May: April's year to date equalled May's rent, and an answer
    // citing that balance scored as the month (ADR 0077).
    const books = new Map(deepBooks().map((b) => [b.company, b]));
    for (const item of deepDataset().filter((i) => /_month$/u.test(i.id))) {
      const book = books.get(item.company);
      const e = item.label.expect[0];
      if (book === undefined || e?.kind !== "money") throw new Error(item.id);
      const closings = book.ledgers.flatMap((l) =>
        Object.values(l.closing).map((c) => (c < 0n ? -c : c)),
      );
      expect(closings, item.id).not.toContain(BigInt(e.paise));
    }
  });

  it("holds the books to the configuration and calendar the expected values assume", async () => {
    const threshold = await pool().query<{ value: string }>(
      `select value #>> '{}' as value from app_config where key = 'semantic.fuzzy_threshold' order by version desc limit 1`,
    );
    expect(threshold.rows[0]?.value).toBe(DEEP_FUZZY_THRESHOLD);
    for (const b of deepBooks())
      expect(Number.parseInt(b.months[0]?.slice(5, 7) ?? "", 10), b.company).toBe(
        DEEP_FY_START_MONTH,
      );
  });

  it("puts figures of six to ten crore in front of the redactor (ADR 0077)", () => {
    const large = deepBooks().find((b) => b.company === "trading_large");
    const items = deepDataset().filter((i) => i.id.startsWith("trading_large:"));
    expect(items.map((i) => i.id.split(":")[1]).sort()).toEqual([
      "bank_close",
      "receivables_total",
      "sales_ytd",
    ]);
    for (const i of items) {
      const e = i.label.expect[0];
      // Ten digits starting 6 to 9: the shape of an Indian mobile number.
      expect(e?.kind === "money" ? e.paise : "", i.id).toMatch(/^[6-9]\d{9}$/u);
    }
    expect(large).toBeDefined();
  });

  it("gives pending bills that add up to the party balances they come from", () => {
    // The first live run found them apart: a question answered from bills and the same question
    // answered from balances disagreed, and the model was marked down for the eval's own fault.
    const sum = (vs: readonly bigint[]) => vs.reduce((s, v) => s + v, 0n);
    for (const b of deepBooks()) {
      const last = b.months.at(-1) ?? "";
      const end = (group: string) =>
        b.ledgers.filter((l) => l.groupPath === group).map((l) => l.closing[last] ?? 0n);
      const billed = (side: string) =>
        sum(b.bills.filter((x) => x.side === side).map((x) => x.amount));
      expect(billed("receivable"), b.company).toBe(
        sum(end("Current Assets > Sundry Debtors").filter((v) => v > 0n)),
      );
      expect(billed("payable"), b.company).toBe(
        -sum(end("Current Liabilities > Sundry Creditors").filter((v) => v < 0n)),
      );
    }
  });

  it("clears the activation floor with every question answerable or plainly not", () => {
    const items = deepDataset();
    expect(items.length).toBeGreaterThanOrEqual(50);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(
      items.filter((i) => i.label.scope === "out_of_scope").length,
    ).toBeGreaterThanOrEqual(8);
    for (const i of items.filter((x) => x.label.expect.length > 0))
      expect(i.oracle.sql, i.id).not.toBeNull();
  });
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
