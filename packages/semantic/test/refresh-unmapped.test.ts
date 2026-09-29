/**
 * A ledger nothing could place stays settled (ADR 0069).
 *
 * Every mapping a run makes is written back as a company rule, except Unmapped, which is kept in
 * `acceptedUnmapped` instead. The cascade used to read only the rules, so that ledger came back
 * unmatched every month and was sent to the model again. While ledger mapping had no active
 * prompt the call was refused before it was made; once it went live, every refresh of such a
 * company made an AI call on unchanged structure — the one thing the recurring margin rests on
 * never happening. This follows one ledger from setup to the next month.
 */

import { describe, expect, it } from "vitest";

import {
  applyAiMappings,
  runCascade,
  type CascadeContext,
  type SourceLedger,
} from "../src/cascade";
import { HEADS_VERSION } from "../src/heads";
import { GLOBAL_LIBRARY_SEED, indexLibrary } from "../src/library";
import { writeBack } from "../src/rules";

const base: CascadeContext = {
  companyRules: [],
  accountRules: [],
  library: indexLibrary(GLOBAL_LIBRARY_SEED),
  fuzzyThreshold: "0.85",
};

// A flat trial balance: one ledger the rules place, and one bare party token they cannot.
const ledgers: SourceLedger[] = [
  { groupPath: [], name: "Rent Received" },
  { groupPath: [], name: "PARTY_03fd5e8a61bc" },
];

describe("a ledger left Unmapped at setup", () => {
  it("is not sent to the model again on the next month's refresh", () => {
    // Setup: the party token is left for the model, and the model rightly declines it.
    const setup = runCascade(ledgers, base);
    expect(setup.unmatched.map((u) => u.ledger.name)).toEqual(["PARTY_03fd5e8a61bc"]);
    const refs = new Map(
      setup.unmatched.map((u, i) => [`l${i.toString()}`, u.ledgerKey]),
    );
    const mappings = applyAiMappings(
      setup,
      [{ ref: "l0", head: null, confidence: "low" }],
      refs,
    );
    const { rules } = writeBack(
      null,
      mappings.map((m) => ({
        ...m,
        applyToAllCompanies: false,
        normalisedName: m.ledgerKey,
      })),
      HEADS_VERSION,
    );
    expect(rules.acceptedUnmapped).toEqual([setup.unmatched[0]?.ledgerKey]);

    // The refresh, as the run builds its context from the blueprint: nothing left for the model.
    const refresh = runCascade(ledgers, {
      ...base,
      companyRules: rules.rules,
      acceptedUnmapped: rules.acceptedUnmapped,
    });
    expect(refresh.unmatched).toEqual([]);
    const party = refresh.mappings.find(
      (m) => m.ledgerKey === setup.unmatched[0]?.ledgerKey,
    );
    expect(party).toMatchObject({
      head: "UNMAPPED",
      source: "company_rule",
      needsReview: true,
    });
  });

  it("would have been sent again without the blueprint's record of it", () => {
    // The shape of the defect, kept so the test above cannot pass for the wrong reason.
    expect(runCascade(ledgers, base).unmatched).toHaveLength(1);
  });

  it("is placed by a company rule if one is later written for it", () => {
    const key = runCascade(ledgers, base).unmatched[0]?.ledgerKey ?? "";
    const out = runCascade(ledgers, {
      ...base,
      companyRules: [{ ledgerKey: key, head: "CA_RECEIVABLES" }],
      acceptedUnmapped: [key],
    });
    expect(out.mappings.find((m) => m.ledgerKey === key)?.head).toBe("CA_RECEIVABLES");
  });
});
