/** What a new company's form is pre-filled with (ADR 0030, ADR 0084). */

import { describe, expect, it } from "vitest";

import {
  defaultConventions,
  defaultStatutoryFormat,
  isStatutoryFormat,
  STATUTORY_FORMATS,
} from "./reporting-conventions";

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

describe("statutory layouts (ADR 0087)", () => {
  it("start from the currency the books are in, and IFRS for everything not named", () => {
    expect(defaultStatutoryFormat("INR")).toBe("schedule_iii");
    expect(defaultStatutoryFormat("gbp")).toBe("uk_companies_act");
    expect(defaultStatutoryFormat("USD")).toBe("us_gaap");
    for (const currency of ["EUR", "AED", "SGD", "AUD", "ZAR"])
      expect(defaultStatutoryFormat(currency)).toBe("ifrs");
  });

  it("accept only the codes the database's check allows", () => {
    expect(STATUTORY_FORMATS.map((f) => f.code)).toEqual([
      "schedule_iii",
      "uk_companies_act",
      "us_gaap",
      "ifrs",
      "none",
    ]);
    expect(isStatutoryFormat("ifrs")).toBe(true);
    expect(isStatutoryFormat("gaap")).toBe(false);
    expect(isStatutoryFormat(null)).toBe(false);
  });
});
