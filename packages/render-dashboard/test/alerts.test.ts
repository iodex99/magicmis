import type { MetricValue } from "@magicmis/engine";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { alertFires, firedAlerts, type AlertRule } from "../src/alerts";

const at = (
  metricId: string,
  value: string | null,
  unit: MetricValue["unit"] = "paise",
  period = "2026-05",
): MetricValue => ({
  metricId,
  period: period as MetricValue["period"],
  dims: {},
  value,
  nullReason: value === null ? "missing_data" : null,
  unit,
  formula: "",
  inputs: [],
});

const rule = (
  metricId: string,
  comparator: "below" | "above",
  threshold: string,
): AlertRule => ({
  id: `${metricId}-${comparator}`,
  metricId,
  comparator,
  threshold,
});

describe("alerts on a company's own figures (ADR 0087)", () => {
  const values = [
    at("cash_and_bank", "45000000"),
    at("dso", "61.250000", "days"),
    at("gross_margin_pct", "31.500000", "percent"),
    at("current_ratio", null, "ratio"),
    at("cash_and_bank", "90000000", "paise", "2026-04"),
  ];

  it("fires on the month it is asked about, money in minor units, days and percent exactly", () => {
    expect(
      alertFires(rule("cash_and_bank", "below", "50000000"), values, "2026-05"),
    ).not.toBeNull();
    expect(
      alertFires(rule("cash_and_bank", "below", "50000000"), values, "2026-04"),
    ).toBeNull();
    expect(alertFires(rule("dso", "above", "60"), values, "2026-05")).not.toBeNull();
    expect(alertFires(rule("dso", "above", "61.25"), values, "2026-05")).toBeNull();
    expect(
      alertFires(rule("gross_margin_pct", "below", "31.5"), values, "2026-05"),
    ).toBeNull();
    expect(
      alertFires(rule("gross_margin_pct", "below", "31.500001"), values, "2026-05"),
    ).not.toBeNull();
  });

  it("never fires on a value that is not there", () => {
    expect(alertFires(rule("current_ratio", "below", "1"), values, "2026-05")).toBeNull();
    expect(alertFires(rule("revenue", "below", "1"), values, "2026-05")).toBeNull();
  });

  it("lists every alert that fires and no other", () => {
    const fired = firedAlerts(
      [rule("cash_and_bank", "below", "50000000"), rule("dso", "below", "30")],
      values,
      "2026-05",
    );
    expect(fired.map((f) => f.rule.metricId)).toEqual(["cash_and_bank"]);
  });

  it("agrees with integer comparison for any money amount and threshold", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }),
        fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }),
        (value, threshold) => {
          const v = [at("cash_and_bank", value.toString())];
          const below = alertFires(
            rule("cash_and_bank", "below", threshold.toString()),
            v,
            "2026-05",
          );
          const above = alertFires(
            rule("cash_and_bank", "above", threshold.toString()),
            v,
            "2026-05",
          );
          expect(below !== null).toBe(value < threshold);
          expect(above !== null).toBe(value > threshold);
        },
      ),
    );
  });

  it("agrees with exact comparison for any decimal value and threshold, however written", () => {
    // Millionths as integers, written out as decimals with the trailing zeros the engine keeps
    // and a threshold that may drop them, as a person types it: "60" against "60.000001".
    const decimal = (n: bigint, places: number) => {
      const sign = n < 0n ? "-" : "";
      const abs = n < 0n ? -n : n;
      const whole = (abs / 1_000_000n).toString();
      const fraction = (abs % 1_000_000n).toString().padStart(6, "0").slice(0, places);
      return places === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
    };
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
        fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
        fc.integer({ min: 0, max: 6 }),
        (value, raw, places) => {
          // The threshold as typed carries only `places` decimals, so compare against that.
          const step = 10n ** BigInt(6 - places);
          const threshold = (raw / step) * step;
          const v = [at("dso", decimal(value, 6), "days")];
          const typed = decimal(threshold, places);
          const below = alertFires(rule("dso", "below", typed), v, "2026-05");
          const above = alertFires(rule("dso", "above", typed), v, "2026-05");
          expect(below !== null).toBe(value < threshold);
          expect(above !== null).toBe(value > threshold);
        },
      ),
    );
  });
});
