/**
 * Mapping rules as stored in the blueprint (SPEC §9 `blueprints.mapping_rules`, encrypted) and
 * the write-back step (SPEC §18): confirmed mappings become company rules in the next blueprint
 * version; the user may promote a mapping to an account rule.
 */

import { z } from "zod";

import type { AccountRule, CompanyRule, Mapping } from "./cascade";
import { isHeadCode } from "./heads";

const headCode = z.string().refine(isHeadCode, "unknown MIS head");

export const companyRuleSchema = z.object({
  ledgerKey: z.string().min(1).max(2000),
  head: headCode,
});

export const mappingRulesSchema = z.object({
  schemaVersion: z.literal(1),
  headsVersion: z.number().int().positive(),
  rules: z.array(companyRuleSchema),
  /** Ledgers the user explicitly accepted as Unmapped (SPEC §21 V1). */
  acceptedUnmapped: z.array(z.string()),
});
export type MappingRules = z.infer<typeof mappingRulesSchema>;

export const accountRuleSchema = z.object({
  pattern: z.string().min(1).max(500),
  head: headCode,
});

export interface ConfirmedMapping extends Mapping {
  /** Set when the user ticked "apply to all my companies". */
  readonly applyToAllCompanies: boolean;
  /** Normalised ledger name, for account rules. */
  readonly normalisedName: string;
}

/**
 * The next version's rules: every confirmed mapping becomes (or replaces) a company rule;
 * existing rules for ledgers not seen this time are kept, so a ledger that disappears for a month
 * keeps its mapping when it returns.
 */
export function writeBack(
  previous: MappingRules | null,
  confirmed: readonly ConfirmedMapping[],
  headsVersion: number,
): { rules: MappingRules; accountRules: AccountRule[] } {
  const byKey = new Map<string, CompanyRule>();
  for (const r of previous?.rules ?? []) byKey.set(r.ledgerKey, r);
  const accepted = new Set(previous?.acceptedUnmapped ?? []);
  const accountRules: AccountRule[] = [];

  for (const m of confirmed) {
    if (m.head === "UNMAPPED") {
      byKey.delete(m.ledgerKey);
      accepted.add(m.ledgerKey);
      continue;
    }
    accepted.delete(m.ledgerKey);
    byKey.set(m.ledgerKey, { ledgerKey: m.ledgerKey, head: m.head });
    if (m.applyToAllCompanies)
      accountRules.push({ pattern: m.normalisedName, head: m.head });
  }

  return {
    rules: mappingRulesSchema.parse({
      schemaVersion: 1,
      headsVersion,
      rules: [...byKey.values()].sort((a, b) => a.ledgerKey.localeCompare(b.ledgerKey)),
      acceptedUnmapped: [...accepted].sort(),
    }),
    accountRules,
  };
}
