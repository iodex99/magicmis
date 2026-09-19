/** ADR 0047: unticking a file hides its months, and every figure that was computed from them. */

import type { PeriodId } from "@magicmis/core/time";
import { describe, expect, it } from "vitest";

import type { MetricInput, MetricValue } from "../src/values";
import { monthsBehind, visibleValues } from "../src/visible";

const P = (s: string) => s as PeriodId;
const v = (
  metricId: string,
  period: string,
  inputs: MetricInput[] = [],
): MetricValue => ({
  metricId,
  period: P(period),
  dims: {},
  value: "1",
  nullReason: null,
  unit: "paise",
  formula: "",
  inputs,
});
const on = (metricId: string, period: string): MetricInput => ({
  kind: "metric",
  metricId,
  period: P(period),
});
const ids = (values: readonly MetricValue[]) =>
  values.map((x) => `${x.metricId}@${x.period}`).sort();

const store = [
  v("revenue", "2026-03"),
  v("revenue", "2026-04"),
  v("revenue", "2026-05"),
  v("revenue.mom_abs", "2026-05", [on("revenue", "2026-05"), on("revenue", "2026-04")]),
  v("revenue.mom_abs", "2026-04", [on("revenue", "2026-04"), on("revenue", "2026-03")]),
  v("revenue.yoy_abs", "2026-05", [on("revenue", "2026-05"), on("revenue", "2025-05")]),
  v("revenue.ytd", "2026-05", [on("revenue", "2026-05")]),
  v("revenue.ytd", "2026-03", [on("revenue", "2026-03")]),
  v("revenue.ly_ytd", "2027-05", [on("revenue", "2026-05")]),
];

describe("visibleValues", () => {
  it("changes nothing when nothing is hidden", () => {
    expect(visibleValues(store, new Set(), 4)).toEqual(store);
  });

  it("hides a month, and every figure computed from it", () => {
    const shown = ids(visibleValues(store, new Set(["2026-04"]), 4));
    expect(shown).toEqual(
      [
        "revenue@2026-03",
        "revenue@2026-05",
        // May's change on April is gone: it states something about April.
        // April's own change is gone with April.
        "revenue.yoy_abs@2026-05",
        // March is in the previous financial year, so its year-to-date does not include April…
        "revenue.ytd@2026-03",
        // …while May's does, and last-year-to-date read in May 2027 does too.
      ].sort(),
    );
  });

  it("treats a year-to-date total as standing on every month of the year up to it", () => {
    expect(monthsBehind(v("revenue.ytd", "2026-06"), 4)).toEqual([
      "2026-06",
      "2026-04",
      "2026-05",
    ]);
    expect(monthsBehind(v("revenue.ly_ytd", "2027-05"), 4)).toEqual([
      "2027-05",
      "2026-04",
      "2026-05",
    ]);
    // A January financial year reaches back to January, not April.
    expect(monthsBehind(v("revenue.ytd", "2026-03"), 1)).toEqual([
      "2026-03",
      "2026-01",
      "2026-02",
    ]);
  });

  it("brings everything back when the month is shown again", () => {
    const hidden = new Set(["2026-05"]);
    expect(visibleValues(store, hidden, 4).length).toBeLessThan(store.length);
    hidden.clear();
    expect(visibleValues(store, hidden, 4)).toEqual(store);
  });
});
