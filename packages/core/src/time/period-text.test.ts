import { describe, expect, it } from "vitest";

import { periodFromText } from "./period-text";

describe("periodFromText", () => {
  it.each([
    ["Trial Balance As of March 31, 2026", "2026-03"],
    ["1-Apr-25 to 31-Mar-26", "2026-03"],
    ["Balance as at 31/03/2026", "2026-03"],
    ["TB_Mar-2026.xlsx", "2026-03"],
    ["tb march 2026", "2026-03"],
    ["Trial balance Feb'26", "2026-02"],
    ["2026-01 trial balance.csv", "2026-01"],
    ["TB 11-2025.xlsx", "2025-11"],
    ["For the period ended 30 June 2025", "2025-06"],
    ["Sep 30th, 2025", "2025-09"],
  ])("reads %s", (text, expected) => {
    expect(periodFromText(text)).toBe(expected);
  });

  it("reads numeric dates in the company's order", () => {
    expect(periodFromText("as at 03/04/2026")).toBe("2026-04");
    expect(periodFromText("as at 03/04/2026", "month_first")).toBe("2026-03");
  });

  it("returns null rather than guess", () => {
    for (const text of [
      "Trial Balance",
      "Sheet1",
      "Ledger 2026",
      "Invoice 1234-5678",
      "Marchant Traders",
    ])
      expect(periodFromText(text), text).toBeNull();
  });
});
