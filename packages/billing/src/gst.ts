/**
 * GST on credit purchases (SPEC §13).
 *
 * Same state → CGST and SGST, each at half the rate; different state → IGST at the full
 * rate. Each tax is computed on the taxable value and rounded to the paisa on its own, as
 * each is a separate levy on the invoice — so CGST and SGST are always equal.
 */

import {
  formatDecimal,
  parseDecimal,
  percentOf,
  type RoundingMode,
} from "@magicmis/core/money";

export interface GstBreakdown {
  readonly taxablePaise: bigint;
  readonly ratePercent: string;
  readonly supply: "intra_state" | "inter_state";
  readonly cgstPaise: bigint;
  readonly sgstPaise: bigint;
  readonly igstPaise: bigint;
  readonly gstPaise: bigint;
  readonly totalPaise: bigint;
}

const STATE_CODE = /^[0-9]{2}$/u;

/** Half of a decimal rate, exactly: "18" → "9", "5" → "2.5". */
export function halfRate(ratePercent: string): string {
  const d = parseDecimal(ratePercent);
  const s = formatDecimal({ unscaled: d.unscaled * 5n, scale: d.scale + 1 });
  return s.includes(".") ? s.replace(/\.?0+$/u, "") : s;
}

export function computeGst(input: {
  taxablePaise: bigint;
  ratePercent: string;
  sellerStateCode: string;
  placeOfSupplyStateCode: string;
  rounding: RoundingMode;
}): GstBreakdown {
  if (input.taxablePaise <= 0n)
    throw new RangeError("computeGst: taxable value must be positive");
  if (
    !STATE_CODE.test(input.sellerStateCode) ||
    !STATE_CODE.test(input.placeOfSupplyStateCode)
  ) {
    throw new RangeError("computeGst: state codes must be two digits");
  }
  if (parseDecimal(input.ratePercent).unscaled < 0n)
    throw new RangeError("computeGst: negative rate");

  if (input.sellerStateCode === input.placeOfSupplyStateCode) {
    const half = percentOf(
      input.taxablePaise,
      halfRate(input.ratePercent),
      input.rounding,
    );
    return {
      taxablePaise: input.taxablePaise,
      ratePercent: input.ratePercent,
      supply: "intra_state",
      cgstPaise: half,
      sgstPaise: half,
      igstPaise: 0n,
      gstPaise: half * 2n,
      totalPaise: input.taxablePaise + half * 2n,
    };
  }
  const igst = percentOf(input.taxablePaise, input.ratePercent, input.rounding);
  return {
    taxablePaise: input.taxablePaise,
    ratePercent: input.ratePercent,
    supply: "inter_state",
    cgstPaise: 0n,
    sgstPaise: 0n,
    igstPaise: igst,
    gstPaise: igst,
    totalPaise: input.taxablePaise + igst,
  };
}

/** SPEC §13: buyer's GSTIN state code if given, otherwise the billing state. */
export function placeOfSupply(account: {
  gstin: string | null;
  stateCode: string;
}): string {
  return account.gstin !== null && account.gstin !== ""
    ? account.gstin.slice(0, 2)
    : account.stateCode;
}
