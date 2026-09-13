import type { PeriodId } from "@magicmis/core/time";
import type { MetricValue } from "@magicmis/engine";
import { describe, expect, it } from "vitest";

import { metricsIn, periodsIn, retrieveFacts } from "../src/retriever";

const v = (
  metricId: string,
  period: string,
  value: string,
  unit: MetricValue["unit"] = "paise",
): MetricValue => ({
  metricId,
  period: period as PeriodId,
  dims: {},
  value,
  nullReason: null,
  unit,
  formula: "",
  inputs: [],
});

const store: MetricValue[] = [
  ...["2025-05", "2026-04", "2026-05"].flatMap((p) => [
    v("revenue", p, "1000000"),
    v("gross_margin_pct", p, "30.000000", "percent"),
    v("pat", p, "100000"),
    v("receivables", p, "500000"),
  ]),
  v("revenue.mom_abs", "2026-05", "20000"),
  v("revenue.mom_pct", "2026-05", "2.000000", "percent"),
  v("revenue.ytd", "2026-05", "2000000"),
  v("revenue", "2026-05", "1", "paise"),
];
const available = new Set(store.map((s) => s.period));

describe("retriever", () => {
  it("finds metrics by their MIS vocabulary, longest phrase first", () => {
    expect(metricsIn("How did sales and gross margin % move?")).toEqual([
      "gross_margin_pct",
      "revenue",
    ]);
    expect(metricsIn("What are sundry debtors now?")).toEqual(["receivables"]);
    expect(metricsIn("hello")).toEqual([]);
  });

  it("reads periods relative to the latest month", () => {
    const latest = "2026-05" as PeriodId;
    expect(periodsIn("revenue this month", latest, available)).toEqual(["2026-05"]);
    expect(periodsIn("revenue last month", latest, available)).toEqual(["2026-04"]);
    expect(periodsIn("revenue in May 2025", latest, available)).toEqual(["2025-05"]);
    expect(periodsIn("revenue in april", latest, available)).toEqual(["2026-04"]);
    expect(periodsIn("same month last year", latest, available)).toEqual(["2025-05"]);
    expect(periodsIn("revenue in March 2020", latest, available)).toEqual(["2026-05"]);
  });

  it("returns facts with the facts-pack placeholder IDs and caps them", () => {
    const r = retrieveFacts("Why did sales change this month, and year to date?", store, {
      maxFacts: 20,
    });
    expect(r.facts.map((f) => f.id)).toEqual([
      "m:revenue@2026-05",
      "mv:revenue.mom@2026-05:abs",
      "mv:revenue.mom@2026-05:pct",
      "m:revenue.ytd@2026-05",
    ]);
    expect(retrieveFacts("anything", store, { maxFacts: 2 }).facts).toHaveLength(2);
    expect(retrieveFacts("anything", [], { maxFacts: 5 }).facts).toEqual([]);
  });
});
