/**
 * Refresh drift (SPEC §23): compare this month's sheet signatures with the blueprint's
 * `source_fingerprints`. Beyond the configured share of changed signatures (or a changed report
 * type), the refresh is priced as `refresh_with_restructure` and needs confirmation.
 */

import { parseDecimal } from "@magicmis/core/money";

export interface DriftResult {
  readonly matched: number;
  readonly added: number;
  readonly removed: number;
  /** changed / union, as an exact fraction. */
  readonly changedNumerator: number;
  readonly changedDenominator: number;
  readonly beyondThreshold: boolean;
}

/**
 * Signatures are keyed by source role (e.g. "trial_balance"); a value is the header signature,
 * which already encodes normalised headers, inferred types and the detected report type.
 */
export function compareFingerprints(
  previous: Readonly<Record<string, string>>,
  current: Readonly<Record<string, string>>,
  threshold: string,
): DriftResult {
  const prevValues = new Set(Object.values(previous));
  const curValues = new Set(Object.values(current));
  const union = new Set([...prevValues, ...curValues]);
  let matched = 0;
  for (const v of curValues) if (prevValues.has(v)) matched += 1;
  const added = curValues.size - matched;
  const removed = prevValues.size - matched;
  const changed = union.size - matched;
  const t = parseDecimal(threshold);
  const beyondThreshold =
    union.size > 0 &&
    BigInt(changed) * 10n ** BigInt(t.scale) > t.unscaled * BigInt(union.size);
  return {
    matched,
    added,
    removed,
    changedNumerator: changed,
    changedDenominator: union.size,
    beyondThreshold,
  };
}
