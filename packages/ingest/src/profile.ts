/**
 * Structural profile of a sheet: headers, per-column types and counts, hidden flags, title
 * metadata, header signature. Counts and structure only — no cell content — so it is the
 * base of what may later leave the browser, after redaction (SPEC §2.8, §17).
 */

import { z } from "zod";

import { detectHeader, type HeaderDetection } from "./header";
import { cellAt, columnCount, isBlankRow, type SheetGrid } from "./grid";
import { headerSignature } from "./fingerprint";
import { inferColumn, type ColumnInference } from "./infer";

export const INFERENCE_SAMPLE_ROWS = 10_000;

export interface ColumnProfile extends ColumnInference {
  readonly index: number;
  readonly header: string;
  /** Body rows the type (and `fitting`, `distinct`) was inferred from; `nonBlank` covers all rows. */
  readonly sampledRows: number;
}

export interface SheetProfile {
  readonly sheet: string;
  readonly hidden: boolean;
  readonly hiddenRowCount: number;
  readonly mergeCount: number;
  readonly totalRows: number;
  readonly bodyRows: number;
  readonly header: HeaderDetection | null;
  readonly columns: readonly ColumnProfile[];
  readonly reportType: string;
  readonly signature: string | null;
}

/** Report detection is injected so this package does not depend on `packages/tally`. */
export type ReportDetector = (
  sheet: SheetGrid,
  header: HeaderDetection | null,
  columns: readonly ColumnProfile[],
) => string;

export async function profileSheet(
  sheet: SheetGrid,
  detectReport: ReportDetector = () => "generic",
): Promise<SheetProfile> {
  const header = detectHeader(sheet);
  const width = columnCount(sheet);
  const bodyStart = header?.bodyStart ?? 0;
  let bodyRows = 0;
  for (let r = bodyStart; r < sheet.rows.length; r += 1)
    if (!isBlankRow(sheet.rows[r])) bodyRows += 1;

  // Types are inferred from the first INFERENCE_SAMPLE_ROWS body rows: enough to type a column
  // reliably, and it keeps profiling linear in columns rather than cells for very large sheets
  // (SPEC §33: 50 MB in under 60 s). Non-blank counts cover every row.
  const sampleEnd = Math.min(sheet.rows.length, bodyStart + INFERENCE_SAMPLE_ROWS);
  const columns: ColumnProfile[] = [];
  for (let c = 0; c < width; c += 1) {
    const cells = [];
    for (let r = bodyStart; r < sampleEnd; r += 1) cells.push(cellAt(sheet, r, c));
    const inferred = inferColumn(cells);
    let nonBlank = inferred.nonBlank;
    for (let r = sampleEnd; r < sheet.rows.length; r += 1) {
      const cell = sheet.rows[r]?.[c];
      if (cell !== undefined && cell.value !== null && cell.text.trim() !== "")
        nonBlank += 1;
    }
    columns.push({
      index: c,
      header: header?.headers[c] ?? `Column ${(c + 1).toString()}`,
      ...inferred,
      nonBlank,
      sampledRows: sampleEnd - bodyStart,
    });
  }
  const reportType = detectReport(sheet, header, columns);
  const signature =
    header === null
      ? null
      : await headerSignature({
          headers: columns.map((c) => c.header),
          types: columns.map((c) => c.type),
          reportType,
        });

  return {
    sheet: sheet.name,
    hidden: sheet.hidden,
    hiddenRowCount: sheet.hiddenRows.length,
    mergeCount: sheet.merges.length,
    totalRows: sheet.rows.length,
    bodyRows,
    header,
    columns,
    reportType,
    signature,
  };
}

/** Ingestion limits (SPEC §15), from `app_config.ingest.limits`. */
export const ingestLimitsSchema = z.object({
  max_file_bytes: z.number().int().positive(),
  max_session_bytes: z.number().int().positive(),
  max_files_per_job: z.number().int().positive(),
  zip_max_entries: z.number().int().positive(),
  zip_max_uncompressed_bytes: z.number().int().positive(),
  zip_max_ratio: z.number().positive(),
});
export type IngestLimits = z.infer<typeof ingestLimitsSchema>;

export type FileKind = "xlsx" | "xlsm" | "xls" | "csv";

export function fileKind(name: string): FileKind | null {
  const ext = /\.([a-z0-9]+)$/iu.exec(name)?.[1]?.toLowerCase();
  return ext === "xlsx" || ext === "xlsm" || ext === "xls" || ext === "csv" ? ext : null;
}

export type LimitRefusal =
  "unsupported_type" | "file_too_large" | "session_too_large" | "too_many_files";

/** Checks before reading a byte of content. */
export function checkFiles(
  files: readonly { name: string; size: number }[],
  limits: IngestLimits,
): { ok: true } | { ok: false; reason: LimitRefusal; file?: string } {
  if (files.length > limits.max_files_per_job)
    return { ok: false, reason: "too_many_files" };
  let total = 0;
  for (const f of files) {
    if (fileKind(f.name) === null)
      return { ok: false, reason: "unsupported_type", file: f.name };
    if (f.size > limits.max_file_bytes)
      return { ok: false, reason: "file_too_large", file: f.name };
    total += f.size;
  }
  if (total > limits.max_session_bytes) return { ok: false, reason: "session_too_large" };
  return { ok: true };
}
