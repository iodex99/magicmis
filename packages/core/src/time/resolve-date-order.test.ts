import { describe, expect, it } from "vitest";

import { resolveDateOrder } from "./detect-date-order";

describe("resolveDateOrder (ADR 0031)", () => {
  it("follows what the column proves, even against the company's setting", () => {
    expect(resolveDateOrder("day_first", ["03/25/2026", "04/02/2026"])).toBe(
      "month_first",
    );
    expect(resolveDateOrder("month_first", ["25/03/2026"])).toBe("day_first");
  });

  it("uses the setting when the values prove nothing", () => {
    expect(resolveDateOrder("month_first", ["03/04/2026", "05/06/2026"])).toBe(
      "month_first",
    );
    expect(resolveDateOrder("day_first", [])).toBe("day_first");
  });

  it("refuses to pick an order for a column that proves both", () => {
    expect(resolveDateOrder("day_first", ["25/03/2026", "03/25/2026"])).toBeNull();
  });
});
