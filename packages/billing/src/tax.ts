/**
 * What tax a sale carries, which depends on where the buyer is (SPEC §13, ADR 0030).
 *
 * Two treatments, and they are mutually exclusive:
 *
 * - **India** — a domestic supply. GST applies: CGST and SGST within the seller's state,
 *   IGST across states. Billed in rupees.
 * - **Anywhere else** — an **export of services**, zero-rated under §16 of the IGST Act
 *   when the recipient is outside India, the place of supply is outside India, and payment
 *   is received in convertible foreign exchange. Billed in US dollars, which is what makes
 *   the last of those true.
 *
 * This sits above `computeGst` rather than inside it. `computeGst` knows how to split a
 * rate between two levies and nothing else; deciding whether there is a levy at all is a
 * different question, and mixing them is how a zero-rated sale acquires a tax line.
 */

import { billingCurrency, isExportSale, type Currency } from "@magicmis/core/money";
import { isCountryCode, normaliseCountry } from "@magicmis/core/identifiers";
import type { RoundingMode } from "@magicmis/core/money";

import { computeGst, type GstBreakdown } from "./gst";

export type TaxTreatment = "gst" | "export_zero_rated";

/**
 * The tax outcome of a sale, in integer minor units of `currency`.
 *
 * Named `minor` rather than `paise` because it is cents for a dollar sale. The columns it
 * is written to were renamed for the same reason (migration 0037): a field called `paise`
 * holding cents is a trap laid for whoever reads it next.
 */
export interface SaleTax {
  readonly currency: Currency;
  readonly treatment: TaxTreatment;
  readonly taxableMinor: bigint;
  readonly cgstMinor: bigint;
  readonly sgstMinor: bigint;
  readonly igstMinor: bigint;
  readonly taxMinor: bigint;
  readonly totalMinor: bigint;
  readonly ratePercent: string;
  readonly supply: "intra_state" | "inter_state" | "export";
  /** An Indian GST state code, or null for an export — an export has no Indian state. */
  readonly placeOfSupplyStateCode: string | null;
  readonly buyerCountry: string;
}

export interface SaleTaxInput {
  readonly taxableMinor: bigint;
  readonly buyerCountry: string;
  /** Required for an Indian sale, ignored for an export. */
  readonly placeOfSupplyStateCode?: string | undefined;
  readonly sellerStateCode: string;
  readonly ratePercent: string;
  readonly rounding: RoundingMode;
}

export function computeSaleTax(input: SaleTaxInput): SaleTax {
  const country = normaliseCountry(input.buyerCountry);
  if (!isCountryCode(country)) {
    // A country nobody can resolve is an invoice nobody can defend, and the difference
    // between "IN" and anything else is the difference between charging tax and not.
    throw new RangeError(
      `computeSaleTax: ${JSON.stringify(input.buyerCountry)} is not an ISO 3166-1 alpha-2 country`,
    );
  }
  if (input.taxableMinor <= 0n) {
    throw new RangeError("computeSaleTax: taxable value must be positive");
  }

  const currency = billingCurrency(country);

  if (isExportSale(country)) {
    return {
      currency,
      treatment: "export_zero_rated",
      taxableMinor: input.taxableMinor,
      cgstMinor: 0n,
      sgstMinor: 0n,
      igstMinor: 0n,
      taxMinor: 0n,
      // Zero-rated is not "tax we forgot to add": the total is the taxable value, and the
      // invoice says under which provision.
      totalMinor: input.taxableMinor,
      ratePercent: "0",
      supply: "export",
      placeOfSupplyStateCode: null,
      buyerCountry: country,
    };
  }

  const pos = input.placeOfSupplyStateCode;
  if (pos === undefined) {
    throw new RangeError("computeSaleTax: an Indian sale needs a place of supply");
  }
  const gst: GstBreakdown = computeGst({
    taxablePaise: input.taxableMinor,
    ratePercent: input.ratePercent,
    sellerStateCode: input.sellerStateCode,
    placeOfSupplyStateCode: pos,
    rounding: input.rounding,
  });
  return {
    currency,
    treatment: "gst",
    taxableMinor: gst.taxablePaise,
    cgstMinor: gst.cgstPaise,
    sgstMinor: gst.sgstPaise,
    igstMinor: gst.igstPaise,
    taxMinor: gst.gstPaise,
    totalMinor: gst.totalPaise,
    ratePercent: gst.ratePercent,
    supply: gst.supply,
    placeOfSupplyStateCode: pos,
    buyerCountry: country,
  };
}
