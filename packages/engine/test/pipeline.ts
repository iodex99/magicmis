/** Shared test pipeline: fixture file → grid → Tally parse → facts → cascade → DuckDB cube. */

import { detectHeader, readCsvGrid, readExcel, type SheetGrid } from "@magicmis/ingest";
import type { DuckConn } from "@magicmis/ingest/duckdb";
import type { FixtureFile } from "@magicmis/fixtures";
import {
  GLOBAL_LIBRARY_SEED,
  indexLibrary,
  runCascade,
  type Mapping,
} from "@magicmis/semantic";
import { parseBalanceReport, type BalanceReport } from "@magicmis/tally";

import { computeCube, type HeadCube } from "../src/compute";
import { ledgerFactsFromReport, type LedgerFact } from "../src/facts";

export const library = indexLibrary(GLOBAL_LIBRARY_SEED);

export function gridOf(f: FixtureFile): SheetGrid {
  const bytes = f.bytes();
  if (f.format === "csv")
    return readCsvGrid(bytes, f.name.split("/").pop() ?? f.name).grid;
  const sheet = readExcel(bytes).sheets[0];
  if (sheet === undefined) throw new Error(`${f.name}: no sheet`);
  return sheet;
}

export function parseTb(f: FixtureFile): {
  report: BalanceReport;
  facts: LedgerFact[];
  sheet: string;
} {
  const grid = gridOf(f);
  const header = detectHeader(grid);
  if (header === null) throw new Error(`${f.name}: no header`);
  const report = parseBalanceReport(grid, header);
  return {
    report,
    facts: ledgerFactsFromReport(report, { fileId: f.name, sheet: grid.name }),
    sheet: grid.name,
  };
}

export function mapFacts(facts: readonly LedgerFact[]): {
  mappings: Mapping[];
  unmatched: number;
} {
  const out = runCascade(
    facts.map((f) => ({ groupPath: f.groupPath, name: f.name })),
    { companyRules: [], accountRules: [], library, fuzzyThreshold: "0.85" },
  );
  return { mappings: [...out.mappings], unmatched: out.unmatched.length };
}

export async function cubeFor(
  conn: DuckConn,
  facts: readonly LedgerFact[],
  mappings?: readonly Mapping[],
): Promise<HeadCube> {
  return computeCube(conn, {
    facts,
    mappings: mappings ?? mapFacts(facts).mappings,
    fyStartMonth: 4,
  });
}

/** Index into a test array, failing loudly instead of asserting non-null. */
export function at<T>(xs: readonly T[], i: number): T {
  const x = xs[i];
  if (x === undefined) throw new Error(`no element ${i.toString()}`);
  return x;
}
