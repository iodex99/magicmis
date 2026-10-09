/** What the dashboard_layout stage is told about a company (ADR 0056, ADR 0084, ADR 0085). */

import type { MetricValue } from "@magicmis/engine";
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
// pay sheet, which sit beside the MIS library rather than in it.
const services: MetricValue[] = [
  v("revenue", "9000000000"),
  v("revenue.mom_pct", "2.500000"),
  v("employee_cost", "5200000000"),
  v("receivables", "1800000000"),
  v("inventory", null),
  v("headcount", "48"),
  v("gross_pay", "5100000000"),
  v("payroll_cost", "2100000000", { designation: "Senior Associate" }),
  v("payroll_cost", "1900000000", { designation: "Associate" }),
];

describe("layoutInputFor", () => {
  it("offers payroll and its split by designation, which the board can now show (ADR 0085)", () => {
    const input = layoutInputFor(services, 13);
    expect(input.present).toEqual([
      "employee_cost",
      "gross_pay",
      "headcount",
      "payroll_cost",
      "receivables",
      "revenue",
    ]);
    expect(input.dimensioned).toEqual([
      { metricId: "payroll_cost", dimension: "designation", valueCount: 2 },
    ]);
    // Every offered metric is one the stage's check accepts.
    const known = new Set(input.metrics.map((m) => m.id));
    for (const id of input.present) expect(known.has(id)).toBe(true);
  });

  it("offers nothing the board cannot show", () => {
    const input = layoutInputFor([...services, v("mystery_metric", "1")], 13);
    expect(input.present).not.toContain("mystery_metric");
  });

  it("leaves out a metric with no value, and keeps the month count", () => {
    const input = layoutInputFor(services, 13);
    expect(input.present).not.toContain("inventory");
    expect(input.months).toBe(13);
  });

  it("describes a split by how many values it takes, never by the values (ADR 0057)", () => {
    const input = layoutInputFor(services, 13);
    expect(JSON.stringify(input)).not.toContain("Senior Associate");
  });
});
