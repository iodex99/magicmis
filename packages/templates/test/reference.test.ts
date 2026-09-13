import { describe, expect, it } from "vitest";

import { normaliseLabel } from "../src/catalog";
import {
  applyAiBindings,
  bindByLabel,
  bindReferenceLayout,
  buildRecreatedTemplate,
  referenceLayoutAiInput,
  type ReferenceLayout,
} from "../src/reference";
import { templateSectionSchema } from "../src/spec";

const row = (ref: string, label: string, extra: Partial<ReferenceLayout["sheets"][number]["rows"][number]> = {}) => ({
  ref,
  label,
  bold: false,
  indent: 0,
  hasValues: true,
  formula: null,
  sumOf: null,
  numberFormat: null,
  ...extra,
});

const layout: ReferenceLayout = {
  sheets: [
    {
      ref: "s1",
      name: "Data",
      columns: [
        { ref: "s1c2", header: "MoM %", pattern: "mom_pct" },
        { ref: "s1c3", header: "Budget", pattern: "other" },
      ],
      rows: [
        row("s1r3", "Revenue", { hasValues: false, bold: true }),
        row("s1r4", "1. Net Sales"),
        row("s1r5", "Rent"),
        row("s1r6", "Total", { sumOf: [{ row: "s1r4", sign: 1 }, { row: "s1r5", sign: 1 }] }),
        row("s1r7", "", { hasValues: true }),
      ],
    },
  ],
};

describe("label binding", () => {
  it("normalises numbering, punctuation and ampersands", () => {
    expect(normaliseLabel("  (a) Salaries & Wages: ")).toBe("salaries and wages");
    expect(bindByLabel("Salaries & Wages")).toBe("employee_cost");
    expect(bindByLabel("Total Current Assets")).toBe("current_assets");
    expect(bindByLabel("Less: Depreciation")).toBe("depreciation");
    expect(bindByLabel("Rent")).toBeNull();
  });
});

describe("bindings", () => {
  it("binds rules, holds a subtotal until its terms are money, and rejects bad AI subtotals", () => {
    const rules = bindReferenceLayout(layout);
    expect(rules.map((b) => b.kind)).toEqual(["heading", "metric", "unbound", "unbound", "blank"]);
    expect(referenceLayoutAiInput(layout, rules).sheets[0]?.rows.map((r) => r.bound)).toEqual([
      "heading",
      "metric:revenue",
      null,
      null,
    ]);
    // A subtotal proposed over a heading row is not money: it stays unbound.
    const bad = applyAiBindings(layout, rules, [
      { ref: "s1r6", kind: "subtotal", metric: null, terms: [{ row: "s1r3", sign: 1 }], confidence: "high" },
    ]);
    expect(bad.find((b) => b.ref === "s1r6")?.kind).toBe("unbound");
    // Once Rent is bound to money, the formula subtotal resolves by rule.
    const good = applyAiBindings(layout, rules, [
      { ref: "s1r5", kind: "metric", metric: "other_opex", terms: null, confidence: "medium" },
    ]);
    expect(good.find((b) => b.ref === "s1r6")).toMatchObject({ kind: "subtotal", source: "rule" });

    const template = buildRecreatedTemplate(layout, bad, { name: "Client MIS" });
    const section = template.sections[0];
    // Reserved sheet names are renamed; comparisons pull in the columns they read.
    expect(section?.sheet).toBe("Data (MIS)");
    expect(section?.columns).toEqual(["current", "previous", "mom_pct"]);
    expect(section?.rows.map((r) => [r.kind, r.label])).toEqual([
      ["heading", "Revenue"],
      ["metric", "1. Net Sales"],
      ["unavailable", "Rent"],
      ["unavailable", "Total"],
    ]);
  });
});

describe("subtotal rows in a section", () => {
  const base = { id: "s", title: "S", sheet: "S", requires: [], columns: ["current"] };
  it("must refer only to rows above", () => {
    const ok = templateSectionSchema.safeParse({
      ...base,
      rows: [
        { kind: "metric", id: "a", label: "A", metric: "revenue" },
        { kind: "subtotal", id: "t", label: "T", terms: [{ row: "a", sign: 1 }] },
      ],
    });
    expect(ok.success).toBe(true);
    const forward = templateSectionSchema.safeParse({
      ...base,
      rows: [
        { kind: "subtotal", id: "t", label: "T", terms: [{ row: "a", sign: 1 }] },
        { kind: "metric", id: "a", label: "A", metric: "revenue" },
      ],
    });
    expect(forward.success).toBe(false);
  });
});
