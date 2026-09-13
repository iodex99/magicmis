/**
 * Outbound payloads (SPEC §2.8, §14 payload caps, §17): what may leave the browser for a paid
 * action — redacted structural profiles and capped redacted samples. Title lines (company name,
 * address) are never sent; periods are. Amount and date cells pass through as values because
 * the engine needs them and they identify no one; every text cell is redacted.
 *
 * The same object is what the payload inspector displays, so the inspector shows exactly what
 * would be sent.
 */

import { cellAt, isBlankRow, type SheetGrid, type SheetProfile } from "@magicmis/ingest";

import { assertNoRawIdentifiers, type Redactor } from "./redactor";

export interface PayloadCaps {
  /** SPEC §14: 15 sample rows per sheet (config). */
  readonly sampleRowsPerSheet: number;
  /** SPEC §14: 500 distinct values per column, with truncation counts (config). */
  readonly distinctValuesPerColumn: number;
}

export interface OutboundColumn {
  readonly index: number;
  readonly header: string;
  readonly type: string;
  readonly nonBlank: number;
  readonly fitting: number;
  readonly distinct: number;
  readonly drCrSuffixes: readonly string[];
  readonly parenthesesNegative: boolean;
  readonly grouping: readonly string[];
  /** Redacted distinct text values (text-typed columns only), capped. */
  readonly values?: readonly string[];
  readonly valuesTruncated?: number;
}

export interface OutboundSheet {
  readonly fileId: string;
  readonly sheet: string;
  readonly hidden: boolean;
  readonly hiddenRowCount: number;
  readonly mergeCount: number;
  readonly bodyRows: number;
  readonly reportType: string;
  readonly signature: string | null;
  readonly period: { from: string; to: string } | null;
  readonly asAt: string | null;
  readonly columns: readonly OutboundColumn[];
  readonly sample: readonly (readonly (string | null)[])[];
}

// Integers are not passed through: an unlabelled 12-digit run may be an Aadhaar number.
const TYPED = new Set(["amount", "date", "percent", "empty"]);

export async function buildOutboundSheet(input: {
  fileId: string;
  grid: SheetGrid;
  profile: SheetProfile;
  redactor: Redactor;
  caps: PayloadCaps;
  sheetKind: "payroll" | "other";
  sensitiveColumns?: ReadonlySet<number>;
  includeDistinctValuesFor?: ReadonlySet<number>;
}): Promise<OutboundSheet> {
  const { grid, profile, redactor, caps } = input;
  const header = profile.header;
  const redactColumn = (c: number) => ({
    header: profile.columns[c]?.header ?? "",
    sheetKind: input.sheetKind,
    userSensitive: input.sensitiveColumns?.has(c) ?? false,
    typed: TYPED.has(profile.columns[c]?.type ?? "text"),
  });

  const columns: OutboundColumn[] = [];
  for (const col of profile.columns) {
    const base: OutboundColumn = {
      index: col.index,
      header: await redactor.redactText(col.header),
      type: col.type,
      nonBlank: col.nonBlank,
      fitting: col.fitting,
      distinct: col.distinct,
      drCrSuffixes: col.drCrSuffixes,
      parenthesesNegative: col.parenthesesNegative,
      grouping: col.grouping,
    };
    if (input.includeDistinctValuesFor?.has(col.index) === true && !TYPED.has(col.type)) {
      const seen = new Set<string>();
      let total = 0;
      for (let r = header?.bodyStart ?? 0; r < grid.rows.length; r += 1) {
        const text = cellAt(grid, r, col.index).text.trim();
        if (text === "" || seen.has(text)) continue;
        total += 1;
        if (seen.size < caps.distinctValuesPerColumn) seen.add(text);
      }
      const values: string[] = [];
      for (const v of seen)
        values.push(await redactor.redactCell(v, redactColumn(col.index)));
      columns.push({ ...base, values, valuesTruncated: Math.max(0, total - seen.size) });
    } else {
      columns.push(base);
    }
  }

  const sample: (string | null)[][] = [];
  for (
    let r = header?.bodyStart ?? 0;
    r < grid.rows.length && sample.length < caps.sampleRowsPerSheet;
    r += 1
  ) {
    if (isBlankRow(grid.rows[r])) continue;
    const row: (string | null)[] = [];
    for (const col of profile.columns) {
      const cell = cellAt(grid, r, col.index);
      const text = cell.text.trim();
      row.push(
        text === "" ? null : await redactor.redactCell(text, redactColumn(col.index)),
      );
    }
    sample.push(row);
  }

  const out: OutboundSheet = {
    fileId: input.fileId,
    sheet: await redactor.redactText(profile.sheet),
    hidden: profile.hidden,
    hiddenRowCount: profile.hiddenRowCount,
    mergeCount: profile.mergeCount,
    bodyRows: profile.bodyRows,
    reportType: profile.reportType,
    signature: profile.signature,
    period: header?.period ?? null,
    asAt: header?.asAt ?? null,
    columns,
    sample,
  };
  assertNoRawIdentifiers(JSON.stringify(out));
  return out;
}

/** The inspector's view: exactly the JSON that would be sent. */
export function inspectPayload(payload: unknown): string {
  return JSON.stringify(
    payload,
    (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
}
