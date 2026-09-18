import { describe, expect, it } from "vitest";

import { formatCount, formatCredits, formatMoney } from "./actions";

describe("digit grouping", () => {
  it("groups credits the western way for everyone", () => {
    expect(formatCredits("115000")).toBe("115,000");
    expect(formatCredits("1234567")).toBe("1,234,567");
    expect(formatCredits("-2500")).toBe("-2,500");
    expect(formatCredits("999")).toBe("999");
    expect(formatCount("1000000")).toBe("1,000,000");
  });

  it("groups dollars in thousands and rupees in lakhs", () => {
    expect(formatMoney("USD", "109900")).toBe("$1,099.00");
    expect(formatMoney("USD", "2900")).toBe("$29.00");
    expect(formatMoney("INR", "10000000")).toBe("₹1,00,000.00");
    expect(formatMoney("INR", "-250000")).toBe("-₹2,500.00");
  });
});
