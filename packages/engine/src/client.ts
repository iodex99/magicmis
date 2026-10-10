/**
 * What code that reaches the browser may import from the engine (ADR 0091): the placeholder
 * checks, metric labels, value arithmetic and the stored value shape — and nothing that leads to
 * DuckDB, the ledger readers or the spreadsheet libraries behind them.
 *
 * The package's main entry re-exports the computation too, and no workspace package is marked
 * free of side effects, so one value imported from it put ExcelJS and SheetJS — half a megabyte
 * gzipped — on the board, Files and settings, the presenter's notes, the sample and every shared
 * board.
 */

export * from "./commentary";
export * from "./values";
export * from "./value-schema";
