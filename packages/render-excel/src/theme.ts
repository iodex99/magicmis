/**
 * How the workbook looks (ADR 0034).
 *
 * The workbook is the deliverable a client sees: it goes into a board pack, gets printed, and is
 * read beside statements prepared by hand. So it is typeset, not dumped — a title block, a header
 * band, ruled subtotals, aligned figures, no gridlines, and a footer that says what it is on every
 * printed page.
 *
 * Nothing here changes a value or a formula. Presentation only: fonts, fills, rules, widths,
 * alignment and page setup. The colours are the product's own (packages/ui tokens), in the ARGB
 * strings ExcelJS takes.
 *
 * API used, from the ExcelJS 4.4.0 type declarations: `worksheet.views` (`showGridLines`),
 * `worksheet.properties.defaultRowHeight`, `worksheet.headerFooter.oddFooter`,
 * `worksheet.pageSetup.margins`, `worksheet.mergeCells`, `row.height`, `cell.font`, `cell.fill`
 * (`pattern`/`solid`/`fgColor.argb`), `cell.border` (`style`/`color.argb`) and `cell.alignment`.
 */

import type ExcelJS from "exceljs";

export const PALETTE = {
  ink: "FF1B1739",
  accent: "FF5846D2",
  rule: "FFD9D6E6",
  hairline: "FFEDEBF3",
  subtle: "FFF6F5FB",
  text: "FF191824",
  muted: "FF6F6C85",
  white: "FFFFFFFF",
  positive: "FF15724A",
  positiveFill: "FFE4F5EC",
  warning: "FF8A5300",
  warningFill: "FFFDF2E2",
  negative: "FFB03024",
  negativeFill: "FFFCECEB",
} as const;

const FACE = "Calibri";

export const FONT = {
  body: { name: FACE, size: 10, color: { argb: PALETTE.text } },
  bodyBold: { name: FACE, size: 10, bold: true, color: { argb: PALETTE.text } },
  muted: { name: FACE, size: 9, color: { argb: PALETTE.muted } },
  mutedItalic: {
    name: FACE,
    size: 9,
    italic: true,
    color: { argb: PALETTE.muted },
  },
  header: { name: FACE, size: 10, bold: true, color: { argb: PALETTE.white } },
  title: { name: FACE, size: 16, bold: true, color: { argb: PALETTE.white } },
  sheetTitle: { name: FACE, size: 13, bold: true, color: { argb: PALETTE.ink } },
  link: { name: FACE, size: 10, color: { argb: PALETTE.accent }, underline: true },
} as const;

export const solid = (argb: string): ExcelJS.Fill => ({
  type: "pattern",
  pattern: "solid",
  fgColor: { argb },
});

export const line = (
  style: ExcelJS.BorderStyle = "thin",
  argb: string = PALETTE.rule,
): Partial<ExcelJS.Border> => ({ style, color: { argb } });

/** Gridlines off, a comfortable row height, and A4 landscape that fits its width. */
export function chrome(
  ws: ExcelJS.Worksheet,
  options: { freezeRows?: number; freezeCols?: number; footer?: string } = {},
): void {
  ws.views = [
    {
      state: "frozen",
      xSplit: options.freezeCols ?? 0,
      ySplit: options.freezeRows ?? 0,
      showGridLines: false,
    },
  ];
  ws.properties.defaultRowHeight = 15;
  ws.pageSetup.margins = {
    top: 0.6,
    bottom: 0.6,
    left: 0.5,
    right: 0.5,
    header: 0.3,
    footer: 0.3,
  };
  if (options.footer !== undefined)
    ws.headerFooter = {
      oddFooter: `&L&9&K6F6C85${options.footer}&R&9&K6F6C85Page &P of &N`,
    };
}

/** The dark band a table's column headings sit in. */
export function headerBand(
  ws: ExcelJS.Worksheet,
  row: number,
  columns: number,
  options: { height?: number } = {},
): void {
  const r = ws.getRow(row);
  r.height = options.height ?? 22;
  for (let col = 1; col <= columns; col += 1) {
    const cell = ws.getCell(row, col);
    cell.fill = solid(PALETTE.ink);
    cell.font = FONT.header;
    cell.alignment = {
      vertical: "middle",
      horizontal: col === 1 ? "left" : "right",
      wrapText: true,
    };
  }
}

/**
 * A row of headings written into the band. Headings over words are left-aligned over their
 * column; headings over figures sit right, above the digits they describe.
 */
export function writeHeadings(
  ws: ExcelJS.Worksheet,
  row: number,
  headings: readonly string[],
  options: { alignRight?: readonly number[] } = {},
): void {
  headings.forEach((h, i) => {
    ws.getCell(row, i + 1).value = h;
  });
  headerBand(ws, row, headings.length);
  const right = new Set(options.alignRight ?? []);
  headings.forEach((_, i) => {
    ws.getCell(row, i + 1).alignment = {
      vertical: "middle",
      horizontal: right.has(i + 1) ? "right" : "left",
      wrapText: true,
    };
  });
}

/** The title block at the top of a sheet: who it is for, what it is, and in what units. */
export function titleBlock(
  ws: ExcelJS.Worksheet,
  rows: { title: number; subtitle: number },
  text: { title: string; subtitle: string; columns: number },
): void {
  ws.mergeCells(rows.title, 1, rows.title, Math.max(2, text.columns));
  ws.mergeCells(rows.subtitle, 1, rows.subtitle, Math.max(2, text.columns));
  const title = ws.getCell(rows.title, 1);
  title.value = text.title;
  title.font = FONT.sheetTitle;
  title.alignment = { vertical: "middle" };
  ws.getRow(rows.title).height = 24;
  const subtitle = ws.getCell(rows.subtitle, 1);
  subtitle.value = text.subtitle;
  subtitle.font = FONT.muted;
  subtitle.alignment = { vertical: "middle" };
  ws.getRow(rows.subtitle).height = 16;
}

/** Widths in characters: a label column wide enough for a ledger name, figures at a fixed width. */
export function widths(
  ws: ExcelJS.Worksheet,
  first: number,
  rest: number,
  count: number,
): void {
  ws.getColumn(1).width = first;
  for (let col = 2; col <= count + 1; col += 1) ws.getColumn(col).width = rest;
}
