import { describe, expect, it } from "vitest";

import { MONTHLY_FINANCIAL_MIS } from "../src/monthly-financial-mis";
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
    ]);
    expect(resolved.find((r) => r.section.id === "payroll")?.omittedReason).toBe(
      "Payroll cost summary omitted: the files did not include a pay sheet.",
    );
  });
});
