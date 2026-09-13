import { describe, expect, it } from "vitest";

import { classifyHeader, redactReferenceLayout, sumTerms } from "../src/reference-layout";

describe("classifyHeader", () => {
  it.each([
    ["Apr-25", "month"],
    ["April 2025", "month"],
    ["04 2025", "month"],
    ["Current Month", "current"],
    ["Actuals", "current"],
    ["Previous Month", "previous"],
    ["Same month LY", "same_month_ly"],
    ["Variance", "variance"],
    ["Var %", "mom_pct"],
    ["MoM %", "mom_pct"],
    ["YoY Growth", "yoy_pct"],
    ["YoY", "yoy_abs"],
    ["YTD", "ytd"],
    ["LY YTD", "ly_ytd"],
    ["Budget", "other"],
    ["Remarks", "other"],
  ])("%s → %s", (header, pattern) => {
    expect(classifyHeader(header)).toBe(pattern);
  });
});

describe("sumTerms", () => {
  it("reads plain sums of cells and ranges in the same column", () => {
    expect(sumTerms("=C5+C6-C7", "C")).toEqual([
      { row: 5, sign: 1 },
      { row: 6, sign: 1 },
      { row: 7, sign: -1 },
    ]);
    expect(sumTerms("SUM($D$4:$D$6)-D9", "D")).toEqual([
      { row: 4, sign: 1 },
      { row: 5, sign: 1 },
      { row: 6, sign: 1 },
      { row: 9, sign: -1 },
    ]);
  });

  it("refuses anything else", () => {
    expect(sumTerms("=C5*1.18", "C")).toBeNull();
    expect(sumTerms("=C5+D6", "C")).toBeNull();
    expect(sumTerms("=AVERAGE(C5:C9)", "C")).toBeNull();
    expect(sumTerms("='Other sheet'!C5", "C")).toBeNull();
  });
});

describe("redactReferenceLayout", () => {
  it("passes sheet names, headers and labels through the redactor", async () => {
    const layout = {
      sheets: [
        {
          ref: "s1",
          name: "Asha Traders MIS",
          columns: [
            { ref: "s1c2", header: "Current Month", pattern: "current" as const },
          ],
          rows: [
            {
              ref: "s1r4",
              label: "Due from Asha Traders",
              bold: false,
              indent: 0,
              hasValues: true,
              formula: null,
              sumOf: null,
              numberFormat: null,
            },
          ],
        },
      ],
    };
    const redacted = await redactReferenceLayout(layout, (t) =>
      Promise.resolve(t.replace("Asha Traders", "PARTY_9f3a1c2e")),
    );
    expect(JSON.stringify(redacted)).not.toContain("Asha");
    expect(redacted.sheets[0]?.rows[0]?.label).toBe("Due from PARTY_9f3a1c2e");
  });
});
