# 0076 — The workbook reads as the board does

- **Status:** accepted
- **Date:** 2026-09-30
- **Decided by:** the product owner — "fix both the deep chat and excel number formats"
- **Closes:** R-35

## Context

Every money cell in the workbook carries a number-format code chosen by `moneyFormat` from the
engine value. The board shows the same value through `formatPaise`. R-35 asked for the codes to
be opened in Excel and LibreOffice, because only a spreadsheet application can say what a code
actually displays. Until now nothing had opened them.

## What Excel showed

`format-proof` writes 486 cells: 27 values, three styles, three decimal settings, and brackets
on and off. It opens them in Excel through COM, reads each cell's `.Text` (exactly what Excel
draws) and compares it with the board's text for the same value.

The first run had 134 cells that differed. They were three things:

1. **Rounding into a new digit group.** ₹99,99,999.99 shown with no decimals displayed
   `100,00,000` instead of `1,00,00,000`. The pattern was sized from the stored value's seven
   digits, while the displayed value has eight.
2. **A loss too small to show.** Excel picks a format section by the stored value's sign, so a
   loss of one paisa displayed `(0)` or `-0` where the board says `0`. Under `millions`, every
   loss below half a million did. The first fix exposed a third problem: the zero section still
   formats the value, so without the scaling commas it printed `123.45` under a millions
   heading.
3. **Regional grouping.** Excel draws `#,##0` in the machine's regional convention. On this
   Indian-region machine that meant `absolute` showed lakh grouping.

## Decision

- **Size the pattern from the displayed value.** Round half away from zero, as a spreadsheet
  does, and take the digit count after rounding.
- **A negative value that displays as zero gets a zero section.** That section keeps digit
  placeholders, so the reader's own decimal mark is used, and it keeps the millions scaling.
- **`absolute` and `millions` stay on the reader's regional grouping.** A reader in the US or the
  UK sees `1,234,567.89` and a reader in Germany sees `1.234.567,89`. Literal commas would give
  the German reader `1,234,567,89`, a figure that can be misread. Lakh grouping has no regional
  form outside India, so it stays literal.

After the fix, Excel shows all 486 cells exactly as the board does. The comparison allows for
point 3: `absolute` and `millions` are compared in the application's own grouping, which it
learns from two control cells.

## How it stays true

- `pnpm --filter @magicmis/render-excel format-proof --excel` repeats the Excel check on any
  Windows machine with Excel installed.
- CI runs the same 486 cells in LibreOffice on every push (the `formats` job). LibreOffice
  exports the cells to CSV "as shown", using token 9 of its CSV filter
  (<https://help.libreoffice.org/latest/en-US/text/shared/guide/csv_params.html>).
- Unit tests in `packages/render-excel/test/workbook.test.ts` hold the two fixed codes and check
  that every proof case has the board's text to be held to.
