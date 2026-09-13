/**
 * The Data sheet (SPEC §24.1): a normalised long table the report formulas read with SUMIFS.
 * Amounts are integer paise (exact in Excel's doubles far beyond any real balance); report cells
 * divide by 100. Periods carry a numeric index and their FY start index so YTD criteria are numeric.
 */

import { financialYearOf, periodParts, type PeriodId } from "@magicmis/core/time";
import type { HeadCube } from "@magicmis/engine";
import { ancestry, head } from "@magicmis/semantic";

export interface DataRow {
  readonly period: PeriodId;
  readonly periodIndex: number;
  readonly fyStartIndex: number;
  readonly headCode: string;
  readonly headName: string;
  readonly headPath: string;
  readonly subHead: string;
  readonly measure: "movement" | "closing";
  readonly amountPaise: bigint;
}

export const DATA_COLUMNS = [
  "period",
  "period_index",
  "fy_start_index",
  "mis_head_code",
  "mis_head_name",
  "head_path",
  "measure",
  "amount_paise",
  "sub_head",
] as const;

export const periodIndex = (p: PeriodId): number => {
  const { year, month } = periodParts(p);
  return year * 12 + (month - 1);
};

// "/" is literal in both Excel wildcards and engines that translate wildcards to regular expressions.
export const headPath = (code: string): string => `/${ancestry(code).join("/")}/`;

/**
 * Ledger-level rows from the cube (movement and closing), with display names rehydrated in the
 * browser by the caller. Zero rows are omitted; they change no SUMIFS.
 */
export function dataRowsFromCube(
  cube: HeadCube,
  displayName: (ledgerKey: string) => string,
): DataRow[] {
  const rows: DataRow[] = [];
  for (const r of cube.ledgerRows) {
    const base = {
      period: r.period,
      periodIndex: periodIndex(r.period),
      fyStartIndex: periodIndex(financialYearOf(r.period, cube.fyStartMonth).start),
      headCode: r.head,
      headName: head(r.head).name,
      headPath: headPath(r.head),
      subHead: displayName(r.ledgerKey),
    };
    if (r.movement !== null && r.movement !== 0n)
      rows.push({ ...base, measure: "movement", amountPaise: r.movement });
    if (r.closing !== 0n)
      rows.push({ ...base, measure: "closing", amountPaise: r.closing });
  }
  return rows;
}
