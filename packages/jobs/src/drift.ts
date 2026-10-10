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
  /** changed / compared, as an exact fraction. */
  readonly changedNumerator: number;
  readonly changedDenominator: number;
  readonly beyondThreshold: boolean;
}

/** The reports a month's figures are computed from; a new kind of one is a changed report type. */
const BALANCE_ROLES = new Set(["trial_balance", "group_summary"]);

/**
 * The kinds of sheet a run reads figures from. Only these are judged for drift: a notes sheet or a
 * cover page that changes from month to month is no restructure, and nothing in it is mapped.
 */
export const MIS_SOURCE_ROLES: ReadonlySet<string> = new Set([
  ...BALANCE_ROLES,
  "bills_receivable",
  "bills_payable",
  "pay_sheet",
]);

const roleOf = (key: string): string => key.split(":")[0] ?? key;

/**
 * Signatures are keyed `role:index` (e.g. "trial_balance:0"); a value is the header signature,
 * which already encodes normalised headers, inferred types and the detected report type.
 *
 * Only what this month brings is judged (ADR 0091). A file of a kind seen before in a new layout
 * is a change, and so is a balance report of a kind the company never sent; a file left out this
 * month is not, nor is a first debtors or payroll file, which no ledger mapping depends on.
 * Counting the files left out priced every month after a setup with a debtors file — when the
 * customer added that month's trial balance alone — as a restructure, at twice the price.
 */
export function compareFingerprints(
  previous: Readonly<Record<string, string>>,
  current: Readonly<Record<string, string>>,
  threshold: string,
): DriftResult {
  const before = new Map<string, Set<string>>();
  for (const [key, sig] of Object.entries(previous)) {
    const role = roleOf(key);
    if (MIS_SOURCE_ROLES.has(role))
      before.set(role, (before.get(role) ?? new Set()).add(sig));
  }
  const hadBalances = [...before.keys()].some((r) => BALANCE_ROLES.has(r));
  const now = new Map<string, Set<string>>();
  for (const [key, sig] of Object.entries(current)) {
    const role = roleOf(key);
    if (MIS_SOURCE_ROLES.has(role)) now.set(role, (now.get(role) ?? new Set()).add(sig));
  }
  let matched = 0;
  let added = 0;
  for (const [role, sigs] of now) {
    const seen = before.get(role);
    for (const sig of sigs) {
      if (seen?.has(sig) === true) matched += 1;
      else if (seen !== undefined || (hadBalances && BALANCE_ROLES.has(role))) added += 1;
    }
  }
  let removed = 0;
  for (const [role, sigs] of before) if (!now.has(role)) removed += sigs.size;
  const compared = matched + added;
  const t = parseDecimal(threshold);
  const beyondThreshold =
    compared > 0 &&
    BigInt(added) * 10n ** BigInt(t.scale) > t.unscaled * BigInt(compared);
  return {
    matched,
    added,
    removed,
    changedNumerator: added,
    changedDenominator: compared,
    beyondThreshold,
  };
}

/**
 * The signatures to remember after a delivered run (ADR 0091): this run's for every kind of file
 * it brought, and the earlier ones for kinds it did not, so a debtors file sent every quarter is
 * still recognised when it comes back.
 */
export function rememberFingerprints(
  previous: Readonly<Record<string, string>>,
  current: Readonly<Record<string, string>>,
): Record<string, string> {
  const roles = new Set(Object.keys(current).map(roleOf));
  const out: Record<string, string> = {};
  for (const [key, sig] of Object.entries(previous))
    if (!roles.has(roleOf(key))) out[key] = sig;
  for (const [key, sig] of Object.entries(current)) out[key] = sig;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
