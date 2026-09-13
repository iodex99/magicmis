/**
 * Labelled eval datasets built from the synthetic fixtures (SPEC §0.8, §14). No real data.
 *
 * - sheet_classification: every distinct report layout; sheet names and title lines are removed
 *   so the model sees only headers and samples — the case deterministic detection leaves to AI.
 *   Label: the generator's report type.
 * - column_mapping: headers from the same sheets. Label: the deterministic header rules, which
 *   the Phase 3 roundtrip proves correct on every fixture.
 */

import {
  detectHeader,
  inferColumn,
  readCsvGrid,
  readExcel,
  type SheetGrid,
} from "@magicmis/ingest";
import { buildFixtureSet, type FixtureFile } from "@magicmis/fixtures";
import { assignRoles } from "@magicmis/tally";

import type {
  ClassifySheetsInput,
  ClassifySheetsOutput,
  MapColumnsInput,
  MapColumnsOutput,
} from "../src/stages";

export interface EvalItem<I, L> {
  readonly id: string;
  readonly input: I;
  readonly label: L;
}

const SAMPLE_ROWS = 15;

function gridOf(f: FixtureFile): SheetGrid | null {
  const bytes = f.bytes();
  if (f.format === "csv") return readCsvGrid(bytes, f.name).grid;
  return readExcel(bytes).sheets[0] ?? null;
}

interface Parsed {
  readonly file: FixtureFile;
  readonly headers: readonly string[];
  readonly types: readonly string[];
  readonly samples: readonly (readonly string[])[];
}

function parsedFixtures(limit: number): Parsed[] {
  const set = buildFixtureSet({ months: 1 });
  const seen = new Set<string>();
  const out: Parsed[] = [];
  for (const file of set.files) {
    if (file.broken !== undefined) continue;
    const key = `${file.report}:${file.variant}:${file.format}`;
    if (seen.has(key)) continue;
    const grid = gridOf(file);
    const header = grid === null ? null : detectHeader(grid);
    if (grid === null || header === null) continue;
    seen.add(key);
    const body = grid.rows.slice(header.bodyStart);
    const types = header.headers.map((_, c) => inferColumn(body.map((r) => r[c])).type);
    const samples = body
      .slice(0, SAMPLE_ROWS)
      .map((r) => header.headers.map((_, c) => (r[c]?.text ?? "").slice(0, 200)));
    out.push({
      file,
      headers: header.headers.slice(0, 80),
      types: types.slice(0, 80),
      samples,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function sheetClassificationDataset(
  limit = 60,
): EvalItem<
  ClassifySheetsInput,
  ClassifySheetsOutput["sheets"][number]["report_type"]
>[] {
  return parsedFixtures(limit).map((p, i) => ({
    id: `sc-${i.toString()}`,
    input: {
      sheets: [
        {
          ref: "s1",
          name: "Sheet1",
          titleLines: [],
          headers: [...p.headers],
          types: [...p.types],
          samples: p.samples.map((r) => [...r]),
        },
      ],
    },
    label: p.file.report,
  }));
}

export function columnMappingDataset(
  limit = 60,
): EvalItem<
  MapColumnsInput,
  Record<string, MapColumnsOutput["columns"][number]["role"]>
>[] {
  return parsedFixtures(limit).map((p, i) => {
    const roles = assignRoles(p.headers);
    const byIndex = new Map(Object.entries(roles).map(([role, idx]) => [idx, role]));
    const label: Record<string, MapColumnsOutput["columns"][number]["role"]> = {};
    const columns = p.headers.map((header, c) => {
      const ref = `c${c.toString()}`;
      label[ref] = (byIndex.get(c) ??
        null) as MapColumnsOutput["columns"][number]["role"];
      return {
        ref,
        header,
        type: p.types[c] ?? "text",
        samples: p.samples.map((r) => r[c] ?? "").slice(0, 5),
      };
    });
    return {
      id: `cm-${i.toString()}`,
      input: { report_type: p.file.report, columns },
      label,
    };
  });
}
