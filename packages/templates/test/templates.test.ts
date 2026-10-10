import { describe, expect, it } from "vitest";

import { MONTHLY_FINANCIAL_MIS, templateForRun } from "../src/monthly-financial-mis";
import { resolveSections, templateSpecSchema } from "../src/spec";

describe("Monthly Financial MIS", () => {
  it("is a valid spec with unique row ids and sheet names within Excel's limit", () => {
    expect(templateSpecSchema.parse(MONTHLY_FINANCIAL_MIS).id).toBe(
      "monthly_financial_mis",
    );
    const sheets = MONTHLY_FINANCIAL_MIS.sections.map((s) => s.sheet);
    expect(new Set(sheets).size).toBe(sheets.length);
    for (const s of MONTHLY_FINANCIAL_MIS.sections) {
      const ids = s.rows.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("omits sections without data, with a reason for the Checks sheet", () => {
    const resolved = resolveSections(MONTHLY_FINANCIAL_MIS, new Set(["balances"]));
    expect(resolved.filter((r) => r.included).map((r) => r.section.id)).toEqual([
      "pnl",
      "ratios",
      "balance_sheet",
      "cash_flow",
    ]);
    expect(resolved.find((r) => r.section.id === "payroll")?.omittedReason).toBe(
      "Payroll cost summary omitted: the files did not include a pay sheet.",
    );
  });
});

describe("the template a run renders (ADR 0086)", () => {
  // Version 1 exactly as a company set up before the Cash flow sheet stored it.
  const v1 = templateSpecSchema.parse({
    ...MONTHLY_FINANCIAL_MIS,
    version: 1,
    sections: MONTHLY_FINANCIAL_MIS.sections.filter((s) => s.id !== "cash_flow"),
  });

  it("brings an untouched earlier copy up to the current built-in, Cash flow included", () => {
    expect(templateForRun(v1)).toBe(MONTHLY_FINANCIAL_MIS);
    expect(templateForRun(null)).toBe(MONTHLY_FINANCIAL_MIS);
    expect(templateForRun(MONTHLY_FINANCIAL_MIS)).toBe(MONTHLY_FINANCIAL_MIS);
  });

  it("leaves a company's own copy alone, however small the change", () => {
    const renamed = templateSpecSchema.parse({
      ...v1,
      sections: v1.sections.map((s) =>
        s.id === "pnl" ? { ...s, title: "Profit and loss account" } : s,
      ),
    });
    expect(templateForRun(renamed)).toBe(renamed);
    const edited = templateSpecSchema.parse({ ...v1, editedFrom: 3 });
    expect(templateForRun(edited)).toBe(edited);
    const recreated = templateSpecSchema.parse({ ...v1, id: "recreated_mis" });
    expect(templateForRun(recreated)).toBe(recreated);
  });
});
