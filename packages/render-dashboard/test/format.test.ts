import { describe, expect, it } from "vitest";

import { formatValue, metricLabel, periodLabel } from "../src/format";

const LAKHS = { style: "lakhs_crores", decimals: 2 } as const;

describe("formatValue", () => {
  it("formats money from paise strings with Indian grouping", () => {
    expect(formatValue("7455550000", "paise", LAKHS)).toBe("₹7,45,55,500.00");
    expect(
      formatValue("-120000000", "paise", { ...LAKHS, negativesInBrackets: true }),
    ).toContain("(");
  });

  it("rounds decimals at the display boundary only", () => {
    expect(formatValue("-1.583333", "percent", LAKHS)).toBe("-1.6%");
    expect(formatValue("20.000000", "percent", LAKHS)).toBe("20.0%");
    expect(formatValue("1.234567", "ratio", LAKHS)).toBe("1.23");
    expect(formatValue("45.500000", "days", LAKHS)).toBe("46 days");
  });
});

describe("labels", () => {
  it("names metrics and variance forms", () => {
    expect(metricLabel("revenue")).toBe("Revenue from operations");
    expect(metricLabel("revenue.mom_pct")).toBe(
      "Revenue from operations, % change on last month",
    );
    expect(periodLabel("2026-05")).toBe("May 2026");
  });
});
