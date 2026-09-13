import { buildFixtureSet } from "@magicmis/fixtures";
import { PREDEFINED_GROUPS } from "@magicmis/tally";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  aiHeadList,
  applyAiMappings,
  ledgerKey,
  mapLedger,
  runCascade,
  type CascadeContext,
} from "../src/cascade";
import { diceSimilarity, meetsThreshold } from "../src/fuzzy";
import { ancestry, CANONICAL_HEADS, head } from "../src/heads";
import { GLOBAL_LIBRARY_SEED, indexLibrary } from "../src/library";
import { normaliseName } from "../src/normalise";
import {
  acceptAllAsProposed,
  canConfirm,
  confirm,
  filterRows,
  groupByHead,
  initialReview,
  reassign,
  refreshRows,
  type ReviewRow,
} from "../src/review";
import { writeBack } from "../src/rules";
import { ALL_PREDEFINED_HAVE_DEFAULTS } from "../src/tally-defaults";

const library = indexLibrary(GLOBAL_LIBRARY_SEED);
const ctx = (over: Partial<CascadeContext> = {}): CascadeContext => ({
  companyRules: [],
  accountRules: [],
  library,
  fuzzyThreshold: "0.85",
  ...over,
});

describe("canonical heads", () => {
  it("form one tree with unique codes, known parents and consistent classes", () => {
    const codes = new Set<string>();
    for (const h of CANONICAL_HEADS) {
      expect(codes.has(h.code)).toBe(false);
      codes.add(h.code);
    }
    for (const h of CANONICAL_HEADS) {
      if (h.parent !== null) {
        expect(codes.has(h.parent)).toBe(true);
        const parent = head(h.parent);
        if (parent.class !== "memo") expect(h.class).toBe(parent.class);
        expect(h.statement).toBe(parent.statement);
      }
    }
    expect(head("UNMAPPED").statement).toBe("memo");
    expect(head("REV").normalBalance).toBe("credit");
    expect(head("CA_CASH").normalBalance).toBe("debit");
    expect(ancestry("OPEX_RENT")).toEqual(["PL", "OPEX", "OPEX_RENT"]);
  });

  it("every Tally predefined group has a default head", () => {
    expect(ALL_PREDEFINED_HAVE_DEFAULTS).toBe(true);
    expect(PREDEFINED_GROUPS).toHaveLength(28);
  });
});

describe("normaliseName", () => {
  it.each([
    ["Salary A/c", "salary account"],
    ["Printing & Stationery", "printing and stationery"],
    ["Depn. on Furniture", "depreciation on furniture"],
    ["Rent Exp - FY 2025-26", "rent expenses"],
    ["Advance to Supplier 2", "advance to supplier"],
    ["Electricity Mar 2026", "electricity"],
    ["  Misc   Exps ", "miscellaneous expenses"],
    ["2025", "2025"],
  ])("%s → %s", (raw, expected) => {
    expect(normaliseName(raw)).toBe(expected);
  });

  it("property: idempotent", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (s) => {
        const once = normaliseName(s);
        expect(normaliseName(once)).toBe(once);
      }),
    );
  });

  it("the library seed is normalised, points at real heads and has no conflicting names", () => {
    const seen = new Map<string, string>();
    for (const e of GLOBAL_LIBRARY_SEED) {
      expect(head(e.head)).toBeDefined();
      for (const n of [e.name, ...e.aliases]) {
        expect(normaliseName(n), n).toBe(n);
        const prior = seen.get(n);
        expect(prior === undefined || prior === e.head, `${n} maps to two heads`).toBe(
          true,
        );
        seen.set(n, e.head);
      }
    }
  });
});

describe("fuzzy", () => {
  it("compares exactly against the threshold", () => {
    expect(
      meetsThreshold(diceSimilarity("telephone expense", "telephone expenses"), "0.85"),
    ).toBe(true);
    expect(meetsThreshold(diceSimilarity("warehouse rent", "rent"), "0.85")).toBe(false);
    expect(meetsThreshold({ numerator: 17, denominator: 20 }, "0.85")).toBe(true);
    expect(meetsThreshold({ numerator: 16, denominator: 20 }, "0.85")).toBe(false);
  });
});

describe("cascade", () => {
  const l = (groupPath: string[], name: string) => ({ groupPath, name });

  it("applies rules, library and group defaults in order", () => {
    const rent = l(["Indirect Expenses", "Administrative Expenses"], "Office Rent");
    expect(mapLedger(rent, ctx())).toMatchObject({
      kind: "mapped",
      mapping: { head: "OPEX_RENT", source: "global_alias", needsReview: false },
    });
    const withRule = ctx({
      companyRules: [{ ledgerKey: ledgerKey(rent), head: "OPEX_OTHER" }],
    });
    expect(mapLedger(rent, withRule)).toMatchObject({
      mapping: { head: "OPEX_OTHER", source: "company_rule" },
    });
    const withAccount = ctx({
      accountRules: [{ pattern: "office rent", head: "OPEX_REPAIRS" }],
    });
    expect(mapLedger(rent, withAccount)).toMatchObject({
      mapping: { head: "OPEX_REPAIRS", source: "account_rule" },
    });
    expect(mapLedger(l(["Sundry Debtors"], "PARTY_a1b2c3d4e5f6"), ctx())).toMatchObject({
      mapping: { head: "CA_RECEIVABLES", source: "group_default", needsReview: false },
    });
  });

  it("never crosses Tally's class placement; flags the conflict instead", () => {
    // Same name under two groups: an asset deposit and a liability deposit.
    const paid = mapLedger(
      l(["Current Assets", "Deposits (Asset)"], "Security Deposit"),
      ctx(),
    );
    const received = mapLedger(l(["Current Liabilities"], "Security Deposit"), ctx());
    expect(paid).toMatchObject({ mapping: { head: "NCA_DEPOSITS", needsReview: false } });
    expect(received).toMatchObject({
      mapping: { head: "CL_OTHER", source: "group_default", needsReview: true },
    });
    // Power & fuel booked as a direct (manufacturing) expense stays a direct cost.
    const power = mapLedger(
      l(["Direct Expenses", "Manufacturing Expenses"], "Power & Fuel"),
      ctx(),
    );
    expect(power).toMatchObject({ mapping: { head: "COGS_DIRECT", needsReview: true } });
  });

  it("uses custom group names from the library and marks suspense as unmapped", () => {
    expect(
      mapLedger(l(["Indirect Expenses", "Employee Costs"], "Factory Wages"), ctx()),
    ).toMatchObject({
      mapping: { head: "EMP_SALARIES" },
    });
    expect(mapLedger(l(["Suspense A/c"], "Suspense"), ctx())).toMatchObject({
      mapping: { head: "UNMAPPED", needsReview: true },
    });
    expect(mapLedger(l([], "Profit & Loss A/c"), ctx())).toMatchObject({
      mapping: { head: "EQ_RESERVES" },
    });
  });

  it("leaves ungrouped unknown names for AI, and AI answers always need review", () => {
    const out = runCascade(
      [l([], "Zeta Widget Pool"), l([], "Telephon Expenses")],
      ctx(),
    );
    expect(out.unmatched.map((u) => u.ledger.name)).toEqual(["Zeta Widget Pool"]);
    expect(out.mappings[0]).toMatchObject({
      head: "OPEX_COMMS",
      source: "global_fuzzy",
      needsReview: true,
    });
    const key = out.unmatched[0]?.ledgerKey ?? "";
    const refs = new Map([["l1", key]]);
    expect(
      applyAiMappings(
        out,
        [{ ref: "l1", head: "OPEX_OTHER", confidence: "medium" }],
        refs,
      ).at(-1),
    ).toMatchObject({
      head: "OPEX_OTHER",
      source: "ai",
      needsReview: true,
    });
    expect(
      applyAiMappings(out, [{ ref: "l1", head: "MADE_UP", confidence: "high" }], refs).at(
        -1,
      ),
    ).toMatchObject({
      head: "UNMAPPED",
      needsReview: true,
    });
    expect(applyAiMappings(out, [], refs)).toHaveLength(2);
    expect(aiHeadList().some((h) => h.code === "UNMAPPED")).toBe(false);
  });

  it("maps every fixture ledger to the section its Tally group implies", () => {
    const expectedSection = (path: readonly string[]): string => {
      const groups = path.slice(0, -1);
      const name = path.at(-1) ?? "";
      if (groups.length === 0 && name === "Profit & Loss A/c") return "EQ";
      if (groups.includes("Sales Accounts") || groups.includes("Direct Incomes"))
        return "REV";
      if (groups.includes("Indirect Incomes")) return "OTH_INC";
      if (groups.some((g) => ["Purchase Accounts", "Direct Expenses"].includes(g)))
        return "COGS";
      if (groups.includes("Employee Costs")) return "EMP";
      if (name === "Depreciation") return "DA";
      if (groups.includes("Indirect Expenses")) return "OPEX";
      if (groups.some((g) => ["Capital Account"].includes(g))) return "EQ";
      if (groups.includes("Loans (Liability)")) {
        return groups.includes("Bank OD A/c") ? "CL" : "NCL";
      }
      if (groups.includes("Current Liabilities")) return "CL";
      if (groups.includes("Fixed Assets")) return "NCA";
      if (groups.includes("Deposits (Asset)")) return "NCA";
      if (groups.includes("Current Assets")) return "CA";
      return "?";
    };
    const { truths } = buildFixtureSet({ months: 1 });
    let count = 0;
    for (const t of truths) {
      for (const ledger of t.ledgers) {
        expect(ledger.path.at(-1)).toBe(ledger.name);
        const r = mapLedger(
          { groupPath: ledger.path.slice(0, -1), name: ledger.name },
          ctx(),
        );
        expect(r.kind, ledger.name).toBe("mapped");
        if (r.kind !== "mapped") continue;
        expect(
          ancestry(r.mapping.head)[1],
          `${t.company}: ${ledger.path.join(" > ")} → ${r.mapping.head}`,
        ).toBe(expectedSection(ledger.path));
        count += 1;
      }
    }
    expect(count).toBeGreaterThan(90);
  });
});

describe("review model", () => {
  const row = (
    key: string,
    h: string,
    needsReview: boolean,
    source = "group_default" as const,
  ): ReviewRow => ({
    ledgerKey: key,
    displayName: key,
    parentGroup: "Indirect Expenses",
    sourceFile: "tb.xlsx",
    sourceSheet: "Sheet1",
    amountPaise: "100",
    proposed: {
      ledgerKey: key,
      head: h,
      source,
      confidence: "medium",
      needsReview,
      reason: null,
    },
  });

  it("blocks confirmation while needs-review rows remain, unless accepted as proposed", () => {
    let s = initialReview([
      row("a", "OPEX_RENT", false),
      row("b", "UNMAPPED", true),
      row("c", "OPEX_OTHER", true),
    ]);
    expect(canConfirm(s)).toEqual({ ok: false, pending: 2, unmapped: 1 });
    expect(() => confirm(s)).toThrow();
    expect(filterRows(s, { needsReviewOnly: true }).map((r) => r.ledgerKey)).toEqual([
      "b",
      "c",
    ]);
    expect(filterRows(s, { unmappedOnly: true }).map((r) => r.ledgerKey)).toEqual(["b"]);
    s = reassign(s, ["b", "c"], "OPEX_PRINTING");
    expect(canConfirm(s)).toEqual({ ok: true });
    expect(groupByHead(s, s.rows).map((g) => g.head)).toEqual([
      "OPEX_RENT",
      "OPEX_PRINTING",
    ]);
    expect(confirm(s).find((c) => c.ledgerKey === "b")).toMatchObject({
      head: "OPEX_PRINTING",
      source: "company_rule",
    });

    const accepted = acceptAllAsProposed(initialReview([row("x", "UNMAPPED", true)]));
    expect(canConfirm(accepted).ok).toBe(true);
  });

  it("refresh shows only new, changed or previously unmapped ledgers", () => {
    const rows = [
      row("same", "OPEX_RENT", false),
      row("new", "OPEX_RENT", false),
      row("was_unmapped", "OPEX_RENT", false),
      row("changed", "OPEX_OTHER", false),
    ];
    const previous = new Map([
      ["same", "OPEX_RENT"],
      ["was_unmapped", "UNMAPPED"],
      ["changed", "OPEX_RENT"],
    ]);
    expect(refreshRows(rows, previous).map((r) => r.ledgerKey)).toEqual([
      "new",
      "was_unmapped",
      "changed",
    ]);
    expect(refreshRows([row("same", "OPEX_RENT", false)], previous)).toEqual([]);
  });

  it("write-back keeps old rules, records accepted unmapped and emits account rules", () => {
    const { rules, accountRules } = writeBack(
      {
        schemaVersion: 1,
        headsVersion: 1,
        rules: [{ ledgerKey: "old", head: "DA" }],
        acceptedUnmapped: ["b"],
      },
      [
        {
          ledgerKey: "b",
          head: "OPEX_RENT",
          source: "company_rule",
          confidence: "high",
          needsReview: false,
          reason: null,
          applyToAllCompanies: true,
          normalisedName: "godown rent",
        },
        {
          ledgerKey: "c",
          head: "UNMAPPED",
          source: "none",
          confidence: "low",
          needsReview: true,
          reason: null,
          applyToAllCompanies: false,
          normalisedName: "c",
        },
      ],
      1,
    );
    expect(rules.rules).toEqual([
      { ledgerKey: "b", head: "OPEX_RENT" },
      { ledgerKey: "old", head: "DA" },
    ]);
    expect(rules.acceptedUnmapped).toEqual(["c"]);
    expect(accountRules).toEqual([{ pattern: "godown rent", head: "OPEX_RENT" }]);
  });
});
