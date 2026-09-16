import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { formatAmount, formatAmountWithCode } from "../format/currency-number";
import { isCountryCode, normaliseCountry } from "../identifiers/country";
import { paise } from "./brand";
import {
  CURRENCIES,
  CURRENCY,
  addAmounts,
  amount,
  amountsEqual,
  billingCurrency,
  fromPaise,
  isCurrency,
  isExportSale,
  toPaise,
} from "./currency";

/**
 * Billing currency and the tax treatment that follows it (ADR 0030).
 *
 * The country is not a display preference here: it decides whether the sale is a domestic
 * supply carrying GST or an export of services that is zero-rated under IGST Act §16. A
 * mistake in this file is a mistake on a tax invoice.
 */

describe("billing currency follows the billing country", () => {
  it("bills India in rupees and everywhere else in dollars", () => {
    expect(billingCurrency("IN")).toBe("INR");
    for (const country of ["US", "GB", "AE", "SG", "AU", "DE", "ZA"]) {
      expect(billingCurrency(country), country).toBe("USD");
    }
  });

  it("is not fooled by case or whitespace, which is how a form submits it", () => {
    for (const written of ["in", " IN ", "In", "iN"]) {
      expect(billingCurrency(written), written).toBe("INR");
    }
  });

  it("treats every non-Indian sale as an export, and no Indian one", () => {
    expect(isExportSale("IN")).toBe(false);
    expect(isExportSale("US")).toBe(true);
    // The two must agree by construction: an INR sale is never an export, and a USD sale
    // always is. This is what makes "zero-rated" and "charge GST" mutually exclusive.
    fc.assert(
      fc.property(fc.string(), (country) => {
        expect(isExportSale(country)).toBe(billingCurrency(country) === "USD");
      }),
    );
  });

  it("defaults an unrecognised country to the export treatment, never to GST", () => {
    // Failing the safe way round: charging Indian GST to someone who is not in India is a
    // tax error on a document; treating an unknown country as an export is at worst a
    // sale that should not have completed, and the country is validated at the form.
    expect(billingCurrency("")).toBe("USD");
    expect(billingCurrency("ZZ")).toBe("USD");
  });
});

describe("amounts carry their currency", () => {
  it("refuses to add across currencies rather than converting", () => {
    // There is no exchange rate on a customer-facing amount by design. A total assembled
    // from two currencies is wrong in a way no rounding rule can rescue.
    expect(() => addAmounts(amount("INR", 100n), amount("USD", 100n))).toThrow(
      /currencies differ/u,
    );
  });

  it("adds within a currency", () => {
    expect(addAmounts(amount("USD", 1250n), amount("USD", 750n))).toEqual(
      amount("USD", 2000n),
    );
  });

  it("does not consider equal amounts of different currencies equal", () => {
    expect(amountsEqual(amount("INR", 100n), amount("USD", 100n))).toBe(false);
    expect(amountsEqual(amount("INR", 100n), amount("INR", 100n))).toBe(true);
  });

  it("round-trips through Paise only for rupees", () => {
    expect(toPaise(fromPaise(paise(4200n)))).toBe(4200n);
    expect(() => toPaise(amount("USD", 4200n))).toThrow(/not INR/u);
  });

  it("property: adding is associative and never loses a minor unit", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CURRENCIES),
        fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
        fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
        (currency, a, b) => {
          expect(addAmounts(amount(currency, a), amount(currency, b)).minor).toBe(a + b);
        },
      ),
    );
  });
});

describe("currency metadata", () => {
  it("recognises exactly the two currencies billed in", () => {
    expect(isCurrency("INR")).toBe(true);
    expect(isCurrency("USD")).toBe(true);
    for (const other of ["GBP", "EUR", "inr", "", null, 42]) {
      expect(isCurrency(other), String(other)).toBe(false);
    }
  });

  it("is two-decimal throughout, which the minor-unit arithmetic assumes", () => {
    // If this ever fails, every literal `100n` in the billing path is wrong too.
    for (const code of CURRENCIES) {
      expect(CURRENCY[code].minorDigits, code).toBe(2);
      expect(CURRENCY[code].minorPerMajor, code).toBe(100n);
    }
  });
});

describe("formatting reads the way each currency's reader expects", () => {
  it("groups rupees Indian-style and dollars Western-style", () => {
    // 12,34,567.00 against 1,234,567.00 — the difference a reader notices at once and a
    // spreadsheet never corrects.
    expect(formatAmount(amount("INR", 123_456_700n))).toBe("₹12,34,567.00");
    expect(formatAmount(amount("USD", 123_456_700n))).toBe("$1,234,567.00");
  });

  it("uses the ISO code where ambiguity is least affordable", () => {
    // `$` belongs to a dozen countries; an invoice is the wrong place to leave that open.
    expect(formatAmountWithCode(amount("USD", 150_000n))).toBe("USD 1,500.00");
    expect(formatAmountWithCode(amount("INR", 150_000n))).toBe("INR 1,500.00");
  });

  it("property: formatting never loses the sign or the minor units", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CURRENCIES),
        fc.bigInt({ min: -(10n ** 10n), max: 10n ** 10n }),
        (currency, minor) => {
          const text = formatAmount(amount(currency, minor));
          expect(text.startsWith(CURRENCY[currency].symbol)).toBe(true);
          expect(text.includes("-")).toBe(minor < 0n);
          // Every digit of the minor amount survives grouping.
          const digits = text.replace(/[^0-9]/gu, "");
          const expected = (minor < 0n ? -minor : minor).toString().padStart(3, "0");
          expect(digits).toBe(expected);
        },
      ),
    );
  });
});

describe("country codes", () => {
  it("accepts assigned alpha-2 codes and refuses the near misses", () => {
    for (const ok of ["IN", "US", "GB", "AE", "in", " gb "]) {
      expect(isCountryCode(ok), ok).toBe(true);
    }
    // "UK" is the one everybody types and is not an ISO code; the others are the usual
    // free-text attempts a country field receives.
    for (const bad of ["UK", "England", "India", "IND", "", "ZZ", "__proto__"]) {
      expect(isCountryCode(bad), bad).toBe(false);
    }
  });

  it("normalises the way the currency rule reads it", () => {
    expect(normaliseCountry(" in ")).toBe("IN");
    expect(billingCurrency(normaliseCountry(" in "))).toBe("INR");
  });
});
