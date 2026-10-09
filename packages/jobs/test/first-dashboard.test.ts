/** What the dashboard_layout stage is told about a company (ADR 0056, ADR 0084). */

import type { MetricValue } from "@magicmis/engine";
import { METRIC_CATALOG } from "@magicmis/templates";
import { describe, expect, it } from "vitest";

import { layoutInputFor } from "../src/first-dashboard";

const v = (
  metricId: string,
  value: string | null,
  dims: Record<string, string> = {},
): MetricValue => ({
  metricId,
  period: "2026-04" as MetricValue["period"],
  dims,
  value,
  nullReason: value === null ? "missing_data" : null,
  unit: "paise",
  formula: "",
  inputs: [],
});

// A people business: revenue and costs, plus the payroll figures the engine computes from a
// pay sheet — which the dashboard catalog does not hold.
const services: MetricValue[] = [
  v("revenue", "9000000000"),
  v("revenue.mom_pct", "2.500000"),
  v("employee_cost", "5200000000"),
  v("receivables", "1800000000"),
  v("inventory", null),
  v("headcount", "48"),
  v("gross_pay", "5100000000"),
  v("payroll_cost", "2100000000", { designation: "EMP_1a2b3c4d" }),
  v("payroll_cost", "1900000000", { designation: "EMP_5e6f7a8b" }),
];

describe("layoutInputFor", () => {
  it("offers only metrics the board can show, so a payroll company is not refused into the default", () => {
    const input = layoutInputFor(services, 13);
    expect(input.present).toEqual(["employee_cost", "receivables", "revenue"]);
    // Payroll by designation is computed but not showable yet: not offered, so not chosen.
    expect(input.dimensioned).toEqual([]);
    const catalog = new Set(METRIC_CATALOG.map((m) => m.id));
    for (const id of input.present) expect(catalog.has(id)).toBe(true);
  });

  it("leaves out a metric with no value, and keeps the month count", () => {
    const input = layoutInputFor(services, 13);
    expect(input.present).not.toContain("inventory");
    expect(input.months).toBe(13);
  });

  it("still describes a split the catalog can show, by count and never by value", () => {
    const split = [
      ...services,
      v("revenue", "4000000000", { customer: "PARTY_11111111" }),
      v("revenue", "5000000000", { customer: "PARTY_22222222" }),
    ];
    const input = layoutInputFor(split, 13);
    expect(input.dimensioned).toEqual([
      { metricId: "revenue", dimension: "customer", valueCount: 2 },
    ]);
    expect(JSON.stringify(input)).not.toContain("PARTY_");
  });
});
