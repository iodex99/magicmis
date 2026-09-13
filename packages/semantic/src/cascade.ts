/**
 * Mapping cascade (SPEC §18), per ledger, first match wins:
 *
 *   1. company rule (the company's confirmed mapping for this exact ledger path)
 *   2. account rule ("apply to all my companies", by normalised name)
 *   3. global library: exact normalised name, then alias
 *   4. group default: nearest custom group named in the library, else nearest Tally predefined group
 *      — refined by a fuzzy library match inside the same section, marked needs_review
 *   5. fuzzy library match above the threshold when no group is known, marked needs_review
 *   6. unmatched → `mapLedgers` (AI), marked needs_review; still unmatched → Unmapped
 *
 * Class guard: a rule or library head whose class differs from the ledger's group class is not
 * applied (Tally's Direct/Indirect and balance-sheet placement is the accountant's decision); the
 * group default is used and the row is flagged for review. Company rules are the user's own
 * confirmed decision and are applied as-is.
 */

import { predefinedGroup } from "@magicmis/tally";

import {
  diceSimilarity,
  compareSimilarity,
  meetsThreshold,
  type Similarity,
} from "./fuzzy";
import { ancestry, head, isHeadCode, MAPPABLE_HEADS, type HeadClass } from "./heads";
import type { LibraryIndex } from "./library";
import { normaliseName } from "./normalise";
import { groupDefaultHead, specialLedgerHead } from "./tally-defaults";

export type MappingSource =
  | "company_rule"
  | "account_rule"
  | "global_exact"
  | "global_alias"
  | "global_fuzzy"
  | "group_default"
  | "ai"
  | "none";

export type Confidence = "high" | "medium" | "low";

export interface SourceLedger {
  /** Ancestor group names, root first, then nothing else: the ledger's own name is `name`. */
  readonly groupPath: readonly string[];
  readonly name: string;
}

export interface Mapping {
  readonly ledgerKey: string;
  readonly head: string;
  readonly source: MappingSource;
  readonly confidence: Confidence;
  readonly needsReview: boolean;
  /** Why the row needs review, in plain words. */
  readonly reason: string | null;
}

export interface CompanyRule {
  readonly ledgerKey: string;
  readonly head: string;
}

export interface AccountRule {
  /** Normalised ledger name. */
  readonly pattern: string;
  readonly head: string;
}

export interface CascadeContext {
  readonly companyRules: readonly CompanyRule[];
  readonly accountRules: readonly AccountRule[];
  readonly library: LibraryIndex;
  /** `semantic.fuzzy_threshold`, e.g. "0.85". */
  readonly fuzzyThreshold: string;
}

const keyPart = (s: string): string =>
  s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/gu, " and ")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();

/**
 * A ledger's identity within a company: its group path and name, case and punctuation
 * insensitive. Two ledgers with one name under different groups stay distinct.
 */
export function ledgerKey(ledger: SourceLedger): string {
  return [...ledger.groupPath, ledger.name].map(keyPart).join(" > ");
}

interface GroupHead {
  readonly head: string;
  readonly group: string;
  readonly viaLibrary: boolean;
}

function groupHeadOf(ledger: SourceLedger, library: LibraryIndex): GroupHead | null {
  for (let i = ledger.groupPath.length - 1; i >= 0; i -= 1) {
    const group = ledger.groupPath[i] ?? "";
    const predefined = predefinedGroup(group) !== null ? groupDefaultHead(group) : null;
    if (predefined !== null) return { head: predefined, group, viaLibrary: false };
    const norm = normaliseName(group);
    const fromLibrary = library.exact.get(norm) ?? library.alias.get(norm);
    if (fromLibrary !== undefined) {
      // A custom group named in the library still sits under a predefined group; keep the class.
      const parentDefault = groupHeadOf(
        { groupPath: ledger.groupPath.slice(0, i), name: group },
        library,
      );
      if (
        parentDefault === null ||
        head(parentDefault.head).class === head(fromLibrary).class
      )
        return { head: fromLibrary, group, viaLibrary: true };
      return parentDefault;
    }
  }
  return null;
}

const section = (code: string): string => ancestry(code)[1] ?? code;

function bestFuzzy(
  norm: string,
  library: LibraryIndex,
  threshold: string,
  accept: (head: string) => boolean,
): { head: string; sim: Similarity } | null {
  let best: { head: string; sim: Similarity } | null = null;
  for (const e of library.entries) {
    if (!accept(e.head)) continue;
    for (const candidate of [e.name, ...e.aliases]) {
      const sim = diceSimilarity(norm, candidate);
      if (!meetsThreshold(sim, threshold)) continue;
      if (best === null || compareSimilarity(sim, best.sim) > 0)
        best = { head: e.head, sim };
    }
  }
  return best;
}

export type CascadeResult =
  | { readonly kind: "mapped"; readonly mapping: Mapping }
  | { readonly kind: "unmatched"; readonly ledgerKey: string };

export function mapLedger(ledger: SourceLedger, ctx: CascadeContext): CascadeResult {
  const key = ledgerKey(ledger);
  const norm = normaliseName(ledger.name);
  const mapped = (
    h: string,
    source: MappingSource,
    confidence: Confidence,
    reason: string | null = null,
  ): CascadeResult => ({
    kind: "mapped",
    mapping: {
      ledgerKey: key,
      head: h,
      source,
      confidence,
      needsReview: reason !== null || h === "UNMAPPED",
      reason: reason ?? (h === "UNMAPPED" ? "Suspense or unclassified balance" : null),
    },
  });

  // 1. The company's own confirmed rule.
  const companyRule = ctx.companyRules.find((r) => r.ledgerKey === key);
  if (companyRule !== undefined && isHeadCode(companyRule.head))
    return mapped(companyRule.head, "company_rule", "high");

  // Tally's own top-level lines ("Profit & Loss A/c", "Difference in opening balances").
  if (ledger.groupPath.length === 0) {
    const special = specialLedgerHead(ledger.name);
    if (special !== null) return mapped(special, "group_default", "high");
  }

  const group = groupHeadOf(ledger, ctx.library);
  const groupClass: HeadClass | null = group === null ? null : head(group.head).class;
  const fits = (h: string) => groupClass === null || head(h).class === groupClass;
  let conflict: string | null = null;

  // 2. Account rules.
  const accountRule = ctx.accountRules.find((r) => r.pattern === norm);
  if (accountRule !== undefined && isHeadCode(accountRule.head)) {
    if (fits(accountRule.head)) return mapped(accountRule.head, "account_rule", "high");
    conflict = `Your rule for this name points to ${head(accountRule.head).name}, but the ledger sits under ${group?.group ?? "another group"}`;
  }

  // 3. Global library.
  const exact = ctx.library.exact.get(norm);
  if (exact !== undefined) {
    if (fits(exact))
      return conflict === null
        ? mapped(exact, "global_exact", "high")
        : mapped(exact, "global_exact", "medium", conflict);
    conflict ??= `The name suggests ${head(exact).name}, but the ledger sits under ${group?.group ?? "another group"}`;
  }
  const alias = ctx.library.alias.get(norm);
  if (alias !== undefined && exact === undefined) {
    if (fits(alias))
      return conflict === null
        ? mapped(alias, "global_alias", "high")
        : mapped(alias, "global_alias", "medium", conflict);
    conflict ??= `The name suggests ${head(alias).name}, but the ledger sits under ${group?.group ?? "another group"}`;
  }

  // 4. Group default, refined by a fuzzy match within the same section.
  if (group !== null) {
    const refine = bestFuzzy(
      norm,
      ctx.library,
      ctx.fuzzyThreshold,
      (h) =>
        head(h).class === groupClass &&
        section(h) === section(group.head) &&
        h !== group.head,
    );
    if (refine !== null && conflict === null)
      return mapped(
        refine.head,
        "global_fuzzy",
        "low",
        "Close match by name; please confirm",
      );
    return mapped(group.head, "group_default", "medium", conflict);
  }

  // 5. Fuzzy with no group information.
  const fuzzy = bestFuzzy(norm, ctx.library, ctx.fuzzyThreshold, () => true);
  if (fuzzy !== null)
    return mapped(
      fuzzy.head,
      "global_fuzzy",
      "low",
      "Close match by name; please confirm",
    );

  // 6. Left for AI.
  return { kind: "unmatched", ledgerKey: key };
}

export interface CascadeOutput {
  readonly mappings: readonly Mapping[];
  /** Ledgers for `mapLedgers`, keyed by ledger key. */
  readonly unmatched: readonly { ledgerKey: string; ledger: SourceLedger }[];
}

export function runCascade(
  ledgers: readonly SourceLedger[],
  ctx: CascadeContext,
): CascadeOutput {
  const mappings: Mapping[] = [];
  const unmatched: { ledgerKey: string; ledger: SourceLedger }[] = [];
  const seen = new Set<string>();
  for (const l of ledgers) {
    const key = ledgerKey(l);
    if (seen.has(key)) continue;
    seen.add(key);
    const r = mapLedger(l, ctx);
    if (r.kind === "mapped") mappings.push(r.mapping);
    else unmatched.push({ ledgerKey: key, ledger: l });
  }
  return { mappings, unmatched };
}

/** Allowed heads for `mapLedgers` (Unmapped is expressed as null). */
export function aiHeadList(): {
  code: string;
  label: string;
  statement: "profit_and_loss" | "balance_sheet";
}[] {
  return MAPPABLE_HEADS.filter((h) => h.code !== "UNMAPPED").map((h) => ({
    code: h.code,
    label: h.name,
    statement: h.statement === "pnl" ? "profit_and_loss" : "balance_sheet",
  }));
}

/**
 * Folds AI answers into the cascade result. Every AI mapping needs review; an answer outside the
 * allowed heads, or null, leaves the ledger visible under Unmapped. Nothing is dropped.
 */
export function applyAiMappings(
  output: CascadeOutput,
  answers: readonly { ref: string; head: string | null; confidence: Confidence }[],
  refToKey: ReadonlyMap<string, string>,
): Mapping[] {
  const byKey = new Map<string, { head: string | null; confidence: Confidence }>();
  for (const a of answers) {
    const key = refToKey.get(a.ref);
    if (key !== undefined) byKey.set(key, { head: a.head, confidence: a.confidence });
  }
  const out = [...output.mappings];
  for (const u of output.unmatched) {
    const answer = byKey.get(u.ledgerKey);
    const h = answer?.head ?? null;
    if (h !== null && isHeadCode(h) && h !== "UNMAPPED") {
      out.push({
        ledgerKey: u.ledgerKey,
        head: h,
        source: "ai",
        confidence: answer?.confidence ?? "low",
        needsReview: true,
        reason: "Suggested by analysis; please confirm",
      });
    } else {
      out.push({
        ledgerKey: u.ledgerKey,
        head: "UNMAPPED",
        source: "none",
        confidence: "low",
        needsReview: true,
        reason: "No head could be determined",
      });
    }
  }
  return out;
}
