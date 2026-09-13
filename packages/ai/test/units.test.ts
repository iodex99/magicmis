import { describe, expect, it } from "vitest";

import { accuracyString } from "../src/activation";
import { ratio4 } from "../src/margin";
import { structuredOutputSchema } from "../src/schema";
import { Semaphore } from "../src/semaphore";
import {
  classifySheetsOutput,
  mapColumnsOutput,
  mapLedgersOutput,
  mapColumnsSpec,
  extractReferenceLayoutSpec,
  extractReferenceLayoutOutput,
} from "../src/stages";
import { sizeBucket } from "../src/estimator";

const UNSUPPORTED = [
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "pattern",
  "$schema",
];

function walk(node: unknown, visit: (o: Record<string, unknown>) => void): void {
  if (Array.isArray(node))
    node.forEach((n) => {
      walk(n, visit);
    });
  else if (node !== null && typeof node === "object") {
    visit(node as Record<string, unknown>);
    Object.values(node).forEach((v) => {
      walk(v, visit);
    });
  }
}

describe("structured output schemas", () => {
  it.each([
    ["classify", classifySheetsOutput],
    ["columns", mapColumnsOutput],
    ["ledgers", mapLedgersOutput],
    ["reference layout", extractReferenceLayoutOutput],
  ])(
    "%s: supported subset only, closed objects, every property required",
    (_n, schema) => {
      const json = structuredOutputSchema(schema);
      walk(json, (o) => {
        for (const k of UNSUPPORTED) expect(o).not.toHaveProperty(k);
        if (o["type"] === "object") {
          expect(o["additionalProperties"]).toBe(false);
          expect(o["required"]).toEqual(Object.keys(o["properties"] as object));
        }
      });
    },
  );

  it("the Zod schema still enforces what JSON Schema cannot (no digits in prose)", () => {
    const r = classifySheetsOutput.safeParse({
      sheets: [{ ref: "s1", report_type: "other", confidence: "low", reason: "row 5" }],
    });
    expect(r.success).toBe(false);
  });

  it("column mapping rejects a role used twice", () => {
    const problems = mapColumnsSpec.check?.(
      {
        report_type: "trial_balance",
        columns: [
          { ref: "a", header: "Dr", type: "amount", samples: [] },
          { ref: "b", header: "Debit", type: "amount", samples: [] },
        ],
      },
      {
        columns: [
          { ref: "a", role: "debit", confidence: "high" },
          { ref: "b", role: "debit", confidence: "low" },
        ],
      },
    );
    expect(problems).toContain("role debit is used by more than one column");
  });
});

describe("Semaphore", () => {
  it("never runs more than the limit at once and runs everything in order", async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let peak = 0;
    const order: number[] = [];
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        sem.run(async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 5));
          order.push(i);
          active -= 1;
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(order).toHaveLength(8);
    expect(sem.inUse).toBe(0);
  });

  it("releases on failure", async () => {
    const sem = new Semaphore(1);
    await expect(sem.run(() => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    );
    await expect(sem.run(() => Promise.resolve(1))).resolves.toBe(1);
  });
});

describe("ratios", () => {
  it("accuracy rounds down, margin ratios round up", () => {
    expect(accuracyString(2, 3)).toBe("0.6666");
    expect(accuracyString(3, 3)).toBe("1.0000");
    expect(ratio4(2n, 3n)).toBe("0.6667");
    expect(ratio4(0n, 0n)).toBe("0.0000");
  });

  it("size buckets", () => {
    const s = {
      files: 1,
      sheets: 2,
      columns: 10,
      rows: 100,
      distinctLedgerValues: 50,
      referenceMisSheets: 0,
    };
    expect(sizeBucket(s)).toBe("s");
    expect(sizeBucket({ ...s, distinctLedgerValues: 4000 })).toBe("l");
  });
});

describe("extractReferenceLayout check", () => {
  const input = {
    metrics: [{ id: "revenue", label: "Revenue", unit: "money" as const }],
    sheets: [
      {
        ref: "s1",
        name: "P&L",
        columns: ["Current Month"],
        rows: [
          { ref: "s1r4", label: "Sales", bold: false, indent: 0, formula: null, bound: "metric:revenue" },
          { ref: "s1r5", label: "Rent", bold: false, indent: 0, formula: null, bound: null },
          { ref: "s1r6", label: "Total", bold: true, indent: 0, formula: "s1r4+s1r5", bound: null },
        ],
      },
      {
        ref: "s2",
        name: "Other",
        columns: [],
        rows: [{ ref: "s2r4", label: "Order book", bold: false, indent: 0, formula: null, bound: null }],
      },
    ],
  };

  it("accepts an answer for every unbound row with allowed metrics and same-sheet terms", () => {
    expect(
      extractReferenceLayoutSpec.check?.(input, {
        rows: [
          { ref: "s1r5", kind: "unavailable", metric: null, terms: null, confidence: "high" },
          { ref: "s1r6", kind: "subtotal", metric: null, terms: [{ row: "s1r4", sign: 1 }, { row: "s1r5", sign: 1 }], confidence: "medium" },
          { ref: "s2r4", kind: "unavailable", metric: null, terms: null, confidence: "high" },
        ],
      }),
    ).toEqual([]);
  });

  it("lists every problem for the repair turn", () => {
    const problems = extractReferenceLayoutSpec.check?.(input, {
      rows: [
        { ref: "s1r4", kind: "metric", metric: "revenue", terms: null, confidence: "high" },
        { ref: "s1r5", kind: "metric", metric: "rent", terms: null, confidence: "low" },
        { ref: "s1r6", kind: "subtotal", metric: null, terms: [{ row: "s1r6", sign: 1 }, { row: "s2r4", sign: 1 }], confidence: "low" },
      ],
    });
    expect(problems).toEqual([
      "unknown ref s1r4",
      "missing ref s2r4",
      "row s1r5: metric rent is not allowed",
      "row s1r6: a subtotal cannot include itself",
      "row s1r6: term s2r4 is not a row on the same sheet",
    ]);
  });
});
