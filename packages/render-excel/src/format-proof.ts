/**
 * The cases that prove the workbook's number formats read the way the screen does (R-35).
 *
 * Every money cell carries a format code chosen by `moneyFormat` from its engine value, and the
 * screen shows the same value through `formatPaise`. A spreadsheet application applies the code
 * itself, so the only real test is to open the file in one and read what it displays:
 * `pnpm --filter @magicmis/render-excel format-proof -- --excel` does that in Excel,
 * `-- --libreoffice <soffice>` in LibreOffice. The expected text is the screen's own formatter,
 * so a pass means the workbook and the board cannot disagree.
 *
 * The values sit on the edges: zero, a negative too small to show, a value that rounds up into
 * another digit group, every Indian group boundary, and the millions scale.
 */

import { paise } from "@magicmis/core/money";
import { formatPaise } from "@magicmis/core/format";

import { moneyFormat, type NumberStyle } from "./formats";

export interface FormatCase {
  readonly paise: bigint;
  readonly style: NumberStyle;
  readonly decimals: number;
  readonly negativesInBrackets: boolean;
  /** The format code the workbook writes for this value. */
  readonly code: string;
  /** What the screen shows for the same value: what the cell must display. */
  readonly expected: string;
}

const VALUES: readonly bigint[] = [
  0n,
  1n,
  -1n,
  40n,
  -40n,
  49n,
  -49n,
  50n,
  -50n,
  12_345n,
  -12_345n,
  9_999_949n,
  9_999_950n,
  -9_999_950n,
  9_999_960n,
  10_000_000n,
  123_456_789n,
  -123_456_789n,
  999_999_999n,
  12_345_678_900n,
  -12_345_678_900n,
  99_999_999_950n,
  1_234_567_890_123n,
  49_999_999n,
  -49_999_999n,
  150_000_000n,
  -150_000_000n,
];

const STYLES: readonly NumberStyle[] = ["lakhs_crores", "absolute", "millions"];

export function formatProofCases(): FormatCase[] {
  const cases: FormatCase[] = [];
  for (const style of STYLES)
    for (const decimals of [0, 1, 2])
      for (const negativesInBrackets of [true, false])
        for (const value of VALUES)
          cases.push({
            paise: value,
            style,
            decimals,
            negativesInBrackets,
            code: moneyFormat(value, style, decimals, negativesInBrackets),
            expected: formatPaise(paise(value), {
              style,
              decimals,
              negativesInBrackets,
              rounding: "half_up",
            }),
          });
  return cases;
}

/**
 * The number a money cell holds: rupees, as the workbook writes them (`workbook.ts`). Every case
 * is well inside the range where a double holds the paise exactly.
 */
export function cellValue(value: bigint): number {
  return Number.parseInt(value.toString(), 10) / 100;
}
