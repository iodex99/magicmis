import { describe, expect, it } from "vitest";

import { matchFile, nameWords } from "./batch-match";

const companies = [
  {
    id: "northwind",
    name: "Northwind Traders Ltd",
    fileNames: ["TB Northwind Apr 2026.xlsx", "Northwind TB 2026-03.xlsx"],
  },
  {
    id: "harbour",
    name: "Harbour Dental LLP",
    fileNames: ["harbour_dental_trial_balance_04-2026.csv"],
  },
  { id: "kestrel", name: "Kestrel Advisory", fileNames: ["KA-TB-0426.xlsx"] },
];

describe("sorting month-end files to their companies (ADR 0087)", () => {
  it("keeps only the words that say whose a file is", () => {
    expect([...nameWords("TB Northwind May 2026 (final).xlsx")]).toEqual(["northwind"]);
    expect([...nameWords("harbour_dental_trial_balance_05-2026.csv")]).toEqual([
      "harbour",
      "dental",
    ]);
  });

  it("finds the company by its name or by how its files were named before", () => {
    expect(matchFile("TB Northwind May 2026.xlsx", companies)?.companyId).toBe(
      "northwind",
    );
    expect(
      matchFile("harbour_dental_trial_balance_05-2026.csv", companies)?.companyId,
    ).toBe("harbour");
    expect(matchFile("KA-TB-0526.xlsx", companies)?.companyId).toBe("kestrel");
    expect(matchFile("Kestrel May.xlsx", companies)?.companyId).toBe("kestrel");
  });

  it("asks rather than guesses when nothing in the name says, or two companies tie", () => {
    expect(matchFile("TB May 2026.xlsx", companies)).toBeNull();
    expect(matchFile("export (3).csv", companies)).toBeNull();
    expect(
      matchFile("Shared Services May.xlsx", [
        { id: "a", name: "Shared Services North", fileNames: [] },
        { id: "b", name: "Shared Services South", fileNames: [] },
      ]),
    ).toBeNull();
  });
});
