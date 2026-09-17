/** SPEC §34 Phase 7 acceptance: the post-check (V12) rejects injected numerals. */

import type { PeriodId } from "@magicmis/core/time";
import { describe, expect, it } from "vitest";

import {
  buildFactsPack,
  checkCommentary,
  INDIAN_REPORTING,
  type CommentaryOutput,
} from "../src/commentary";
import type { MetricValue } from "../src/values";

const P = "2026-05" as PeriodId;
const mv = (
  metricId: string,
  value: string | null,
  unit: MetricValue["unit"] = "paise",
): MetricValue => ({
  metricId,
  period: P,
  dims: {},
  value,
  nullReason: value === null ? "missing_data" : null,
  unit,
  formula: "",
  inputs: [],
});

const store: MetricValue[] = [
  mv("revenue", "7455550000"),
  mv("revenue.mom_abs", "-120000000"),
  mv("revenue.mom_pct", "-1.583333", "percent"),
  mv("gross_profit", "4100000000"),
  mv("ebitda", "900000000"),
  mv("pat", "700000000"),
  mv("employee_cost", "100000000"),
  mv("employee_cost.mom_abs", "100"),
  mv("employee_cost.mom_pct", "0.000100", "percent"),
  mv("other_opex", "500000000"),
  mv("other_opex.mom_abs", "90000000"),
  mv("other_opex.mom_pct", "21.951219", "percent"),
];
const pack = buildFactsPack({
  period: P,
  store,
  materiality: { pct: "0.05", absMinor: "0" },
  warnings: [],
  conventions: INDIAN_REPORTING,
});
const ALLOW = ["Schedule III", "Ind AS 115", "GSTR-3B"];
const one = (text: string): CommentaryOutput => ({
  sections: [{ heading: "Performance", paragraphs: [{ text }] }],
});

describe("facts pack", () => {
  it("always carries headline metrics and adds others only above materiality", () => {
    const ids = pack.facts.map((f) => f.id);
    expect(ids).toContain("m:revenue@2026-05");
    expect(ids).toContain("mv:revenue.mom@2026-05:pct");
    expect(ids).toContain("m:other_opex@2026-05");
    // A 0.0001% move in employee cost is immaterial.
    expect(ids).not.toContain("m:employee_cost@2026-05");
    expect(pack.facts.find((f) => f.id === "m:revenue@2026-05")?.text).toBe(
      "₹7,45,55,500",
    );
  });
});

describe("placeholder post-check (V12)", () => {
  it("accepts text whose figures are all placeholders, and allowlisted references", () => {
    expect(
      checkCommentary(
        one(
          "Revenue was {{m:revenue@2026-05}}, a change of {{mv:revenue.mom@2026-05:pct}} on {{p:2026-05}}. Presentation follows Schedule III and Ind AS 115; GSTR-3B filings are current.",
        ),
        pack,
        ALLOW,
      ),
    ).toEqual([]);
  });

  it.each([
    ["an amount", "Revenue fell by ₹12 lakh."],
    ["a percentage", "Revenue fell 1.6% on last month."],
    ["a bare number", "Other expenses rose by 21."],
    ["a year", "This is the best May since 2024."],
    ["a quarter", "Q1 was stronger."],
    ["Devanagari digits", "राजस्व १२ प्रतिशत गिरा।"],
    [
      "a figure next to a valid placeholder",
      "Revenue was {{m:revenue@2026-05}} (about 7.4 crore).",
    ],
    ["digits smuggled around an allowlisted phrase", "Schedule III2 applies."],
    ["a currency sign", "Figures are in ₹ throughout."],
  ])("rejects %s", (_label, text) => {
    expect(checkCommentary(one(text), pack, ALLOW).length).toBeGreaterThan(0);
  });

  it("rejects placeholders not in the facts pack, and malformed placeholders", () => {
    expect(checkCommentary(one("Profit was {{m:pat@2025-05}}."), pack, ALLOW)).toEqual([
      "section 1 paragraph 1: unknown placeholder {{m:pat@2025-05}}",
    ]);
    expect(checkCommentary(one("Profit was {{m:pat@2026-05."), pack, ALLOW)).toContain(
      "section 1 paragraph 1: malformed placeholder",
    );
    expect(
      checkCommentary(
        { sections: [{ heading: "Top 5 customers", paragraphs: [] }] },
        pack,
        ALLOW,
      ),
    ).toEqual(["section 1 heading: contains a number outside a placeholder"]);
  });
});
