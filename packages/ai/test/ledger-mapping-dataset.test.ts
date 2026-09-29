import {
  aiHeadList,
  GLOBAL_LIBRARY_SEED,
  indexLibrary,
  mapLedger,
} from "@magicmis/semantic";
import { describe, expect, it } from "vitest";

import { LEDGER_MAPPING_BOOKS, ledgerMappingDataset } from "../evals/ledger-mapping";

// The eval must measure what the model is actually sent: ledgers the cascade leaves unmatched
// (R-29, ADR 0069). A ledger the rules would place is one the model never sees, and scoring it
// would flatter the stage with an easy answer.
const ctx = {
  companyRules: [],
  accountRules: [],
  library: indexLibrary(GLOBAL_LIBRARY_SEED),
  // The seeded `semantic.fuzzy_threshold` (migration 0020).
  fuzzyThreshold: "0.85",
};

const rows = LEDGER_MAPPING_BOOKS.flatMap((b) => b.rows);

describe("ledger mapping dataset", () => {
  it("holds only ledgers the deterministic cascade leaves for the model", () => {
    const placed = rows
      .map(([groupPath, name]) => ({ name, r: mapLedger({ groupPath, name }, ctx) }))
      .filter(({ r }) => r.kind === "mapped")
      .map(({ name }) => name);
    expect(placed).toEqual([]);
  });

  it("accepts only heads the model is allowed to choose", () => {
    const allowed = new Set(aiHeadList().map((h) => h.code));
    const unknown = rows.flatMap(([, name, accept]) =>
      accept
        .filter((h) => h !== null && !allowed.has(h))
        .map((h) => `${name}: ${String(h)}`),
    );
    expect(unknown).toEqual([]);
    for (const [, name, accept] of rows) expect(accept.length, name).toBeGreaterThan(0);
  });

  it("clears the activation floor of fifty scored ledgers, each named once", () => {
    // `ai.eval_min_items` (migration 0039) is checked against scored units, one per ledger.
    expect(rows.length).toBeGreaterThanOrEqual(50);
    const names = rows.map(([groupPath, name]) => [...groupPath, name].join(" > "));
    expect(new Set(names).size).toBe(names.length);
  });

  it("sends each book as mapStep would: refs in order and the full head list", () => {
    const items = ledgerMappingDataset();
    expect(items).toHaveLength(LEDGER_MAPPING_BOOKS.length);
    const heads = aiHeadList();
    for (const item of items) {
      expect(item.input.heads).toEqual(heads);
      expect(item.input.ledgers.map((l) => l.ref)).toEqual(
        item.input.ledgers.map((_, i) => `l${i.toString()}`),
      );
      expect(Object.keys(item.label)).toEqual(item.input.ledgers.map((l) => l.ref));
    }
  });
});
