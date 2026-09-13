/**
 * Mapping review model (SPEC §19): the state behind the review table, independent of React so the
 * rules are unit-tested. Rows are grouped by head; filters, search and bulk reassign operate on
 * ledger keys; confirmation is blocked while needs-review rows remain unless the user accepts
 * them as proposed. Refresh jobs show only new, changed or previously unmapped ledgers.
 */

import type { Mapping, MappingSource } from "./cascade";
import { head, isHeadCode } from "./heads";

export interface ReviewRow {
  readonly ledgerKey: string;
  /** Rehydrated display name (tokens replaced in the browser). */
  readonly displayName: string;
  readonly parentGroup: string;
  readonly sourceFile: string;
  readonly sourceSheet: string;
  /** Period amount in paise as a decimal string (debit positive). */
  readonly amountPaise: string;
  readonly proposed: Mapping;
}

export interface ReviewState {
  readonly rows: readonly ReviewRow[];
  /** ledgerKey → head chosen by the user. */
  readonly overrides: Readonly<Record<string, string>>;
  /** ledgerKey → "apply to all my companies". */
  readonly applyToAll: Readonly<Record<string, boolean>>;
  readonly acceptedAsProposed: boolean;
}

export interface ReviewFilter {
  readonly needsReviewOnly?: boolean | undefined;
  readonly unmappedOnly?: boolean | undefined;
  readonly head?: string | undefined;
  readonly source?: MappingSource | undefined;
  readonly search?: string | undefined;
}

export function initialReview(rows: readonly ReviewRow[]): ReviewState {
  return { rows, overrides: {}, applyToAll: {}, acceptedAsProposed: false };
}

export const currentHead = (s: ReviewState, row: ReviewRow): string =>
  s.overrides[row.ledgerKey] ?? row.proposed.head;

/** A row still needs review until the user touches it (or accepts everything as proposed). */
export const rowNeedsReview = (s: ReviewState, row: ReviewRow): boolean =>
  row.proposed.needsReview &&
  s.overrides[row.ledgerKey] === undefined &&
  !s.acceptedAsProposed;

export function filterRows(s: ReviewState, f: ReviewFilter): ReviewRow[] {
  const q = f.search?.trim().toLowerCase() ?? "";
  return s.rows.filter((r) => {
    const h = currentHead(s, r);
    if (f.needsReviewOnly === true && !rowNeedsReview(s, r)) return false;
    if (f.unmappedOnly === true && h !== "UNMAPPED") return false;
    if (f.head !== undefined && h !== f.head) return false;
    if (f.source !== undefined && r.proposed.source !== f.source) return false;
    if (q !== "" && !`${r.displayName} ${r.parentGroup}`.toLowerCase().includes(q))
      return false;
    return true;
  });
}

export function groupByHead(
  s: ReviewState,
  rows: readonly ReviewRow[],
): { head: string; name: string; rows: ReviewRow[] }[] {
  const groups = new Map<string, ReviewRow[]>();
  for (const r of rows) {
    const h = currentHead(s, r);
    groups.set(h, [...(groups.get(h) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([code, rs]) => ({
      head: code,
      name: head(code).name,
      rows: rs,
      order: head(code).sortOrder,
    }))
    .sort((a, b) => a.order - b.order)
    .map(({ head: h, name, rows: rs }) => ({ head: h, name, rows: rs }));
}

export function reassign(
  s: ReviewState,
  ledgerKeys: readonly string[],
  toHead: string,
): ReviewState {
  if (!isHeadCode(toHead)) throw new RangeError(`unknown head ${toHead}`);
  const overrides = { ...s.overrides };
  for (const k of ledgerKeys) overrides[k] = toHead;
  return { ...s, overrides };
}

export function setApplyToAll(
  s: ReviewState,
  ledgerKey: string,
  value: boolean,
): ReviewState {
  return { ...s, applyToAll: { ...s.applyToAll, [ledgerKey]: value } };
}

export function acceptAllAsProposed(s: ReviewState): ReviewState {
  return { ...s, acceptedAsProposed: true };
}

export type ConfirmCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly pending: number; readonly unmapped: number };

export function canConfirm(s: ReviewState): ConfirmCheck {
  const pending = s.rows.filter((r) => rowNeedsReview(s, r)).length;
  const unmapped = s.rows.filter((r) => currentHead(s, r) === "UNMAPPED").length;
  return pending === 0 ? { ok: true } : { ok: false, pending, unmapped };
}

/** The confirmed mappings to write back. Throws if confirmation is not allowed. */
export function confirm(s: ReviewState): {
  ledgerKey: string;
  head: string;
  applyToAllCompanies: boolean;
  source: MappingSource;
}[] {
  if (!canConfirm(s).ok) throw new Error("mappings still need review");
  return s.rows.map((r) => ({
    ledgerKey: r.ledgerKey,
    head: currentHead(s, r),
    applyToAllCompanies: s.applyToAll[r.ledgerKey] === true,
    source: s.overrides[r.ledgerKey] === undefined ? r.proposed.source : "company_rule",
  }));
}

/**
 * Refresh jobs (SPEC §19): only ledgers that are new, whose mapping changed from the previous
 * blueprint, or that were Unmapped before. An empty result means review is skipped.
 */
export function refreshRows(
  rows: readonly ReviewRow[],
  previous: ReadonlyMap<string, string>,
): ReviewRow[] {
  return rows.filter((r) => {
    const before = previous.get(r.ledgerKey);
    return before === undefined || before === "UNMAPPED" || before !== r.proposed.head;
  });
}
