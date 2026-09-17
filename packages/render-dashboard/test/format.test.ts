import { describe, expect, it } from "vitest";

import {
  compactMoney,
  companyFormat,
  formatValue,
  metricLabel,
  periodLabel,
  unitsNote,
} from "../src/format";

const LAKHS = { style: "lakhs_crores", decimals: 2 } as const;

describe("formatValue", () => {
  it("formats money from paise strings with Indian grouping", () => {
    expect(formatValue("7455550000", "paise", LAKHS, "₹")).toBe("₹7,45,55,500.00");
    expect(
      formatValue("-120000000", "paise", { ...LAKHS, negativesInBrackets: true }, "₹"),
    ).toContain("(");
  });

  it("rounds decimals at the display boundary only", () => {
    expect(formatValue("-1.583333", "percent", LAKHS, "₹")).toBe("-1.6%");
    expect(formatValue("20.000000", "percent", LAKHS, "₹")).toBe("20.0%");
    expect(formatValue("1.234567", "ratio", LAKHS, "₹")).toBe("1.23");
    expect(formatValue("45.500000", "days", LAKHS, "₹")).toBe("46 days");
  });
});

describe("the company's own currency, on every surface (ADR 0034)", () => {
  const dollars = { style: "millions", decimals: 2 } as const;

  it("writes money in the symbol it is given, never a default", () => {
    expect(formatValue("1300000000", "paise", dollars, "$")).toBe("$13.00");
    expect(companyFormat(dollars, "$").money("1300000000")).toBe("$13.00");
    expect(companyFormat(LAKHS, "₹").money("1300000000")).toBe("₹1,30,00,000.00");
  });

  it("says the scale figures are written in", () => {
    expect(unitsNote(dollars, "$")).toBe("Amounts in $ millions");
    expect(unitsNote(LAKHS, "₹")).toBe("Amounts in ₹");
  });

  it("shortens axis labels in the same currency and grouping", () => {
    expect(compactMoney(12_500_000, LAKHS, "₹")).toBe("₹1.25 Cr");
    expect(compactMoney(-350_000, LAKHS, "₹")).toBe("-₹3.5 L");
    expect(compactMoney(12_500_000, dollars, "$")).toBe("$12.5m");
    expect(compactMoney(940, dollars, "$")).toBe("$940");
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
