import { describe, expect, it } from "vitest";

import { lastClosedMonth, monthStatus, portfolioOrder } from "./portfolio-status";

describe("where each company stands this month (ADR 0087)", () => {
  const tenth = new Date("2026-06-10T09:00:00Z");

  it("takes the month that has just ended, across a new year too", () => {
    expect(lastClosedMonth(tenth)).toBe("2026-05");
    expect(lastClosedMonth(new Date("2026-01-03T00:00:00Z"))).toBe("2025-12");
  });

  it("is due when that month is not in yet, and says how far behind", () => {
    expect(monthStatus("2026-05", tenth)).toEqual({ kind: "up_to_date" });
    expect(monthStatus("2026-04", tenth)).toEqual({
      kind: "due",
      month: "2026-05",
      behind: 1,
    });
    expect(monthStatus("2025-12", tenth)).toEqual({
      kind: "due",
      month: "2026-05",
      behind: 5,
    });
    expect(monthStatus(null, tenth)).toEqual({ kind: "not_set_up" });
  });

  it("puts the furthest behind first and the not-yet-set-up last", () => {
    const rows = [
      { name: "Bravo", status: monthStatus("2026-05", tenth) },
      { name: "Alpha", status: monthStatus(null, tenth) },
      { name: "Delta", status: monthStatus("2026-04", tenth) },
      { name: "Charlie", status: monthStatus("2026-01", tenth) },
    ];
    expect(portfolioOrder(rows).map((r) => r.name)).toEqual([
      "Charlie",
      "Delta",
      "Bravo",
      "Alpha",
    ]);
  });
});
