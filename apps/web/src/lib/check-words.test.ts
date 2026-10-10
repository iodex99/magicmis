import { describe, expect, it } from "vitest";

import { CHECK_WORDS, checkLines } from "./check-words";

describe("the checks in plain words (ADR 0087)", () => {
  it("has a sentence for every check a run stores, passed and failed, and no digits in either", () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
      const words = CHECK_WORDS[`V${n.toString()}`];
      expect(words, `V${n.toString()}`).toBeDefined();
      expect(words?.passed).not.toMatch(/\d/u);
      expect(words?.look).not.toMatch(/\d/u);
    }
  });

  it("orders by check, leaves out what did not apply, and separates what to look at", () => {
    const lines = checkLines([
      { id: "V10", status: "fail", severity: "warning" },
      { id: "V3", status: "pass", severity: "blocking" },
      { id: "V9", status: "not_applicable", severity: "warning" },
      { id: "V1", status: "pass", severity: "blocking" },
      { id: "V99", status: "pass", severity: "warning" },
    ]);
    expect(lines.passed).toEqual([CHECK_WORDS["V1"]?.passed, CHECK_WORDS["V3"]?.passed]);
    expect(lines.look).toEqual([{ id: "V10", text: CHECK_WORDS["V10"]?.look }]);
  });

  it("puts a blocking failure before a warning, whatever their order (ADR 0091)", () => {
    const lines = checkLines([
      { id: "V1", status: "fail", severity: "warning" },
      { id: "V8", status: "fail", severity: "warning" },
      { id: "V5", status: "fail", severity: "blocking" },
    ]);
    expect(lines.look.map((l) => l.id)).toEqual(["V5", "V1", "V8"]);
  });
});
