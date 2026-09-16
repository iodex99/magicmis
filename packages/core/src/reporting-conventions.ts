/**
 * How a company's books are written, and sensible defaults for a country (ADR 0030).
 *
 * These are the **reporting company's** conventions, not the account holder's billing
 * ones. A CA firm in Mumbai invoiced in rupees may well report a client whose books are in
 * dirhams, so the account's country only chooses what the form is pre-filled with.
 *
 * Defaults exist so that adding a company stays two fields for almost everyone. A form
 * that asks four questions nobody has an opinion about is the friction ADR 0027 removed;
 * a form that asks none and guesses wrong is worse. Pre-filled and changeable is the
 * answer, and the date order is then checked against the file itself, because it is the
 * one of these where being wrong is invisible.
 *
 * **Two-decimal currencies only.** The engine carries every amount as integer minor units
 * at two decimals (`unit: "paise"` throughout `packages/engine`), so a zero-decimal
 * currency such as JPY or KRW would be read a hundredfold out. Japan is therefore absent
 * from the table below rather than present and quietly wrong; `isReportingCurrency`
 * refuses those codes outright, and TODO(review): R-61 tracks supporting them properly.
 */

import type { DateOrder } from "./time/parse-date";

export type NumberFormat = "lakhs_crores" | "absolute" | "millions";

export interface ReportingConventions {
  /** ISO 4217 of the books being reported. */
  readonly currency: string;
  /** 1–12. The month the financial year starts in. */
  readonly fyStartMonth: number;
  readonly numberFormat: NumberFormat;
  readonly dateOrder: DateOrder;
}

/**
 * The Indian set, and the SPEC §2.14 defaults: April–March, lakhs and crores, day-first.
 * Every Tally export is written this way.
 */
const INDIA: ReportingConventions = {
  currency: "INR",
  fyStartMonth: 4,
  numberFormat: "lakhs_crores",
  dateOrder: "day_first",
};

/**
 * Countries whose conventions differ from the common Western set in a way that matters
 * here. Deliberately short: this is a **default**, changeable on the form, so a country
 * missing from it costs one click rather than being wrong.
 *
 * Financial-year starts are the dominant business convention, not a legal rule — plenty of
 * companies in each country choose a calendar year regardless.
 */
const BY_COUNTRY: Readonly<Record<string, Partial<ReportingConventions>>> = {
  IN: INDIA,
  // The United States writes month-first. This is the entry that earns this table its
  // place: it is the one convention whose absence produces a silently wrong month.
  US: {
    currency: "USD",
    fyStartMonth: 1,
    numberFormat: "millions",
    dateOrder: "month_first",
  },
  GB: { currency: "GBP", fyStartMonth: 4, numberFormat: "millions" },
  AE: { currency: "AED", fyStartMonth: 1, numberFormat: "millions" },
  SG: { currency: "SGD", fyStartMonth: 1, numberFormat: "millions" },
  AU: { currency: "AUD", fyStartMonth: 7, numberFormat: "millions" },
  NZ: { currency: "NZD", fyStartMonth: 4, numberFormat: "millions" },
  CA: { currency: "CAD", fyStartMonth: 1, numberFormat: "millions" },
  ZA: { currency: "ZAR", fyStartMonth: 3, numberFormat: "millions" },
  HK: { currency: "HKD", fyStartMonth: 4, numberFormat: "millions" },
  MY: { currency: "MYR", fyStartMonth: 1, numberFormat: "millions" },
  LK: { currency: "LKR", fyStartMonth: 4, numberFormat: "millions" },
  BD: { currency: "BDT", fyStartMonth: 7, numberFormat: "millions" },
  NP: { currency: "NPR", fyStartMonth: 4, numberFormat: "millions" },
  PK: { currency: "PKR", fyStartMonth: 7, numberFormat: "millions" },
};

/** Everywhere not listed: a calendar year, Western grouping, day-first dates. */
const ELSEWHERE: ReportingConventions = {
  currency: "USD",
  fyStartMonth: 1,
  numberFormat: "millions",
  // Day-first, because most of the world writes it that way — the United States is the
  // notable exception and has its own entry above.
  dateOrder: "day_first",
};

/**
 * What to pre-fill the new-company form with, given where the account is billed.
 *
 * Never applied silently to an existing company: it seeds a form the reader can see and
 * change, which is the difference between a helpful default and a guess.
 */
export function defaultConventions(billingCountry: string | null): ReportingConventions {
  const code = (billingCountry ?? "").trim().toUpperCase();
  const known = BY_COUNTRY[code];
  // No country yet means no evidence either way, so the international set is the default
  // rather than the Indian one. An account that says it is in India gets `INDIA` from the
  // table above, which is the case that actually matters — this branch only covers a
  // company added before billing details exist.
  if (known === undefined) return ELSEWHERE;
  return { ...ELSEWHERE, ...known };
}

/**
 * Currencies with no minor unit, or three of them. The engine assumes two.
 *
 * Refused rather than accepted-and-scaled, because the failure is a factor of a hundred on
 * every figure in a financial report and nothing about it looks wrong on the page.
 */
const NOT_TWO_DECIMAL = new Set([
  // Zero decimals.
  "JPY",
  "KRW",
  "VND",
  "CLP",
  "ISK",
  "XAF",
  "XOF",
  "XPF",
  "PYG",
  "RWF",
  "UGX",
  "VUV",
  "GNF",
  "KMF",
  "DJF",
  "MGA",
  "BIF",
  // Three decimals.
  "BHD",
  "IQD",
  "JOD",
  "KWD",
  "LYD",
  "OMR",
  "TND",
]);

/** Whether a company's books may be reported in this currency. */
export function isReportingCurrency(value: unknown): value is string {
  return (
    typeof value === "string" && /^[A-Z]{3}$/u.test(value) && !NOT_TWO_DECIMAL.has(value)
  );
}

/**
 * The symbol for a reporting currency: `₹`, `$`, `£`, `AED`.
 *
 * Derived from `Intl` rather than a table, for the same reason country names are: a
 * hardcoded list is one more thing that can be wrong, and the runtime already knows. Falls
 * back to the ISO code, which is unambiguous even when it is not pretty — a report headed
 * "AED 12,000" is clear, and one headed with the wrong symbol is not.
 *
 * `symbol` rather than `narrowSymbol`, deliberately: narrow renders SGD, AUD, CAD and HKD
 * all as a bare "$", and a set of accounts that says $ when it means Singapore dollars is
 * wrong in the way that matters most on a financial statement. `symbol` gives A$, CA$,
 * NZ$, HK$ and SGD, and leaves ₹, $ and £ alone.
 */
export function currencySymbol(code: string, locale = "en"): string {
  const upper = code.trim().toUpperCase();
  try {
    const part = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: upper,
      currencyDisplay: "symbol",
    })
      .formatToParts(0)
      .find((p) => p.type === "currency");
    return part?.value ?? upper;
  } catch {
    return upper;
  }
}
