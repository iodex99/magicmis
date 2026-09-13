/**
 * The neutral in-memory shape every reader produces and every analyser consumes.
 *
 * Kept deliberately small: a value as stored, its formatted text as the user saw it, and
 * the flags SPEC §15 requires be surfaced rather than dropped (hidden sheets, hidden rows,
 * merged ranges). Header detection, type inference and the Tally parsers work only on this,
 * so they run the same in a browser Web Worker and in Node tests.
 */

export type CellValue = string | number | boolean | null;

export interface Cell {
  /** The cached value (never a formula's live evaluation). */
  readonly value: CellValue;
  /** Formatted text as displayed, or the value as text when there is no format. */
  readonly text: string;
  /** Excel number format code, when the source had one. */
  readonly format?: string;
}

export interface MergeRange {
  /** 0-based inclusive row/column bounds. */
  readonly startRow: number;
  readonly startCol: number;
  readonly endRow: number;
  readonly endCol: number;
}

export interface SheetGrid {
  readonly name: string;
  readonly hidden: boolean;
  /** Dense rows, 0-based. `rows[r][c]` may be undefined for an empty cell. */
  readonly rows: readonly (readonly (Cell | undefined)[])[];
  /** 0-based indices of rows hidden in the source. */
  readonly hiddenRows: readonly number[];
  readonly merges: readonly MergeRange[];
  /** Excel row outline (grouping) levels by 0-based row, where present. */
  readonly outlineLevels?: readonly (number | undefined)[];
}

export interface WorkbookGrid {
  readonly sheets: readonly SheetGrid[];
}

export const EMPTY_CELL: Cell = { value: null, text: "" };

export function cellAt(sheet: SheetGrid, row: number, col: number): Cell {
  return sheet.rows[row]?.[col] ?? EMPTY_CELL;
}

export const isBlankCell = (cell: Cell | undefined): boolean =>
  cell === undefined || cell.value === null || cell.text.trim() === "";

export function isBlankRow(row: readonly (Cell | undefined)[] | undefined): boolean {
  return row === undefined || row.every(isBlankCell);
}

export function columnCount(sheet: SheetGrid): number {
  let max = 0;
  for (const row of sheet.rows) if (row.length > max) max = row.length;
  return max;
}

/** A grid from plain strings, for tests and CSV. */
export function gridFromText(
  name: string,
  rows: readonly (readonly string[])[],
): SheetGrid {
  return {
    name,
    hidden: false,
    rows: rows.map((r) => r.map((t) => (t === "" ? undefined : { value: t, text: t }))),
    hiddenRows: [],
    merges: [],
  };
}
