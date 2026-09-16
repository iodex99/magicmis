/**
 * The two currencies this product bills in (ADR 0030).
 *
 * India is invoiced in rupees with GST; everywhere else is invoiced in US dollars as a
 * zero-rated export of services. That is the whole of it — there is no per-country tax
 * here, and adding a third currency is a business decision (a tax registration, a
 * settlement account) rather than a line in this file.
 *
 * Both are two-decimal currencies, which is why the existing integer minor-unit
 * representation carries over unchanged. A currency with a different exponent — JPY has
 * none, KWD has three — would need `minorDigits` respected everywhere a literal `100n`
 * appears today, so that assumption is stated here rather than discovered later.
 */

import type { Paise } from "./brand";
import { paise } from "./brand";

export const CURRENCIES = ["INR", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && (CURRENCIES as readonly string[]).includes(value);
}

export interface CurrencyInfo {
  readonly code: Currency;
  readonly symbol: string;
  /** Digits after the decimal point. Both are 2; see the note above before adding a third. */
  readonly minorDigits: 2;
  readonly minorPerMajor: bigint;
  /**
   * Digit grouping. Indian grouping is 2,2,3 from the right (12,34,567) and Western is
   * 3,3,3 (1,234,567) — the difference a reader notices immediately and a spreadsheet
   * never corrects.
   */
  readonly grouping: "indian" | "western";
  /** What a customer paying in this currency is called on an invoice. */
  readonly name: string;
}

export const CURRENCY: Readonly<Record<Currency, CurrencyInfo>> = {
  INR: {
    code: "INR",
    symbol: "₹",
    minorDigits: 2,
    minorPerMajor: 100n,
    grouping: "indian",
    name: "Indian Rupee",
  },
  USD: {
    code: "USD",
    symbol: "$",
    minorDigits: 2,
    minorPerMajor: 100n,
    grouping: "western",
    name: "US Dollar",
  },
};

/**
 * An amount of money that knows what currency it is.
 *
 * Used at the billing boundary, where the currency varies: pack prices, purchases,
 * invoices, gateway orders. `Paise` stays the type wherever the amount is *definitionally*
 * rupees — GST computation, the Indian tax invoice — because there the currency is not a
 * variable and a tag would only invite the question of what happens if it is not INR.
 *
 * `minor` is integer minor units, never a float and never a major-unit decimal.
 */
export interface Amount {
  readonly currency: Currency;
  readonly minor: bigint;
}

export function amount(currency: Currency, minor: bigint): Amount {
  return { currency, minor };
}

export const zeroAmount = (currency: Currency): Amount => amount(currency, 0n);

/**
 * Add two amounts, refusing to mix currencies.
 *
 * Throws rather than converting. There is no exchange rate on a customer-facing amount by
 * design: a price that moves with the market is not a price, and an invoice total assembled
 * from two currencies is wrong in a way no rounding rule can rescue.
 */
export function addAmounts(a: Amount, b: Amount): Amount {
  if (a.currency !== b.currency) {
    throw new TypeError(`cannot add ${a.currency} to ${b.currency}: currencies differ`);
  }
  return amount(a.currency, a.minor + b.minor);
}

export function amountsEqual(a: Amount, b: Amount): boolean {
  return a.currency === b.currency && a.minor === b.minor;
}

/** An INR amount as `Paise`, for the rupee-only paths. Throws on any other currency. */
export function toPaise(value: Amount): Paise {
  if (value.currency !== "INR") {
    throw new TypeError(`toPaise: amount is ${value.currency}, not INR`);
  }
  return paise(value.minor);
}

export function fromPaise(value: Paise): Amount {
  return amount("INR", value);
}

/**
 * The currency a customer in this country is billed in.
 *
 * India is billed in rupees because that is where the seller is registered; everywhere
 * else is billed in dollars, which is also what makes the supply an export of services
 * received in convertible foreign exchange (IGST Act §16). The country is therefore not
 * merely a display preference — it decides the tax treatment of the invoice.
 *
 * `country` is an ISO 3166-1 alpha-2 code.
 */
export function billingCurrency(country: string): Currency {
  return country.trim().toUpperCase() === "IN" ? "INR" : "USD";
}

/** Whether this sale is an export of services, which is the zero-rated case. */
export function isExportSale(country: string): boolean {
  return billingCurrency(country) === "USD";
}
