/** What a new company's form is pre-filled with (ADR 0030, ADR 0084). */

import { describe, expect, it } from "vitest";

import { defaultConventions } from "./reporting-conventions";

describe("defaultConventions", () => {
  it("follows the billing country when there is one", () => {
    expect(defaultConventions("IN")).toMatchObject({
      currency: "INR",
      fyStartMonth: 4,
      numberFormat: "lakhs_crores",
    });
    expect(defaultConventions("us")).toMatchObject({
      currency: "USD",
      fyStartMonth: 1,
      dateOrder: "month_first",
    });
  });

  it("uses where the request came from while no billing country is known (ADR 0084)", () => {
    // Most first companies are added on welcome credits, before any purchase asks for billing
    // details. A firm in India must not open its first company in dollars on a calendar year.
    expect(defaultConventions(null, "IN")).toMatchObject({
      currency: "INR",
      fyStartMonth: 4,
      numberFormat: "lakhs_crores",
    });
    expect(defaultConventions(null, "au")).toMatchObject({
      currency: "AUD",
      fyStartMonth: 7,
    });
  });

  it("lets the billing country win over where the request came from", () => {
    // Someone billed in the UK, travelling in India, keeps the UK's conventions.
    expect(defaultConventions("GB", "IN")).toMatchObject({
      currency: "GBP",
      fyStartMonth: 4,
      numberFormat: "millions",
    });
  });

  it("falls back to the international set with no evidence, or an unlisted country", () => {
    const elsewhere = { currency: "USD", fyStartMonth: 1, numberFormat: "millions" };
    expect(defaultConventions(null)).toMatchObject(elsewhere);
    expect(defaultConventions(null, null)).toMatchObject(elsewhere);
    expect(defaultConventions(null, "BR")).toMatchObject(elsewhere);
    expect(defaultConventions("  ", "")).toMatchObject(elsewhere);
  });
});
