# Phase 3 — Ingestion, Tally, redaction, fixtures

Scope from SPEC §34:

> - Fixture generator with ground truth; worker-based parsing; DuckDB loading with provenance.
> - Header detection, type inference, Tally report detectors and parsers, hierarchy reconstruction.
> - Fingerprints, redaction with payload inspector, session hygiene.
> - *Acceptance:* every fixture parses to ground truth; redaction suite passes; 50 MB performance
>   target met.

## Design

Everything that decides meaning is pure TypeScript over a neutral **`Grid`** (rows of cells with
raw value, formatted text, merge and hidden flags), so it runs identically in a browser Web Worker
and in Node tests. Adapters at the edges produce grids (SheetJS for Excel, a sniffer for CSV) and
consume them (DuckDB-WASM loader).

**`packages/ingest`** (browser-safe; no Node APIs in `src`)

- Limits from config: bytes per file and session, files per job; zip-bomb guard reads the xlsx
  central directory (entry count, declared uncompressed total, compression ratio) *before*
  SheetJS sees the bytes.
- SheetJS read with cached values only (`cellFormula: false`), formatted text, merges, hidden
  sheets/rows flagged (never dropped); `.xlsm` macros are never read (`bookVBA: false`).
- CSV: BOM/UTF-16/UTF-8/Windows-1252 detection, delimiter scoring over `, ; \t |`.
- Header detection: score rows by text density, uniqueness, type contrast with rows below,
  vocabulary; multi-row headers concatenated; title rows above become sheet metadata (company,
  period text).
- Type inference per column: day-first dates (strings and Excel serials; never month-first),
  amounts (Indian and international grouping, parentheses negative, trailing Dr/Cr recorded as an
  explicit sign convention), separate Debit/Credit columns, percentages, identifiers (GSTIN, PAN,
  IFSC), text. Amounts become integer paise; ambiguity is a finding, not a guess.
- Fingerprints: SHA-256 of file bytes (WebCrypto); per-sheet header signature over normalised
  header names + inferred types + detected report type.
- DuckDB loading: one table per sheet with sanitised names, provenance columns `_file_id`,
  `_sheet`, `_source_row` (1-based Excel row), header map kept alongside. Loader talks to a small
  async `DuckConn` interface implemented by DuckDB-WASM (browser: `AsyncDuckDB`; tests: the Node
  blocking bindings of the same package and version).

**`packages/tally`**

- Detectors with confidence for: Trial Balance (group/ledger; opening, debit, credit, closing),
  P&L, Balance Sheet, Group Summary, Ledger Vouchers, Day Book, Sales/Purchase Register, Stock
  Summary, Bills Receivable/Payable, pay sheets; else `generic`.
- Parsers to typed rows; hierarchy reconstruction from indentation, level columns or interleaved
  subtotal rows; `Total`/`Grand Total` rows marked and never aggregated; subtotal = Σ children check
  (feeds V4); same ledger under different groups kept distinct by path; periods from title rows.
- Predefined groups seed with nature and parent (verified below); MIS head / Schedule III mapping
  attaches in Phase 5 when `mis_heads` exists.

**`packages/redact`** (browser)

- Detectors: PAN, Aadhaar (Verhoeff), UAN (labelled columns), IFSC, bank account (labelled
  columns), GSTIN (always), email, Indian mobile, person-name columns (header heuristics + user
  marks), party ledgers (Sundry Debtors/Creditors descendants).
- Tokens: `TYPE_` + truncated HMAC-SHA-256 (WebCrypto) of the normalised value under the
  per-company redaction key; stable across months; collision rate tested at the chosen length.
- Token map built and kept in the browser; rehydration by hashing names in loaded files.
- Payload builder applies redaction to profiles/samples; payload inspector shows the exact JSON.

**`fixtures/generator`**

- Seeded PRNG; three fictional companies (trading, professional services, manufacturing), 14
  months of vouchers → ledger × month balances → TB, P&L, BS, Group Summary, registers, day book,
  outstandings with bill dates, stock summary, pay sheets.
- Tally-like layouts in xlsx and csv, clean and messy (every §16 quirk), plus broken variants
  (unbalanced TB, missing month, duplicate period, subtotal mismatch, backdated closed-month change).
- Machine-readable ground truth JSON. Generated on demand into `fixtures/out/` (gitignored), never
  committed (SPEC §0.8).

**`apps/web`**

- Ingestion Web Worker (Comlink) running SheetJS + DuckDB-WASM, progress per file.
- Pre-payment view shows only file name, size, sheet count, row counts (SPEC §2.3).
- Session hygiene: DuckDB memory + OPFS temp; cleared on logout, "Clear session data", new
  session; best-effort on tab close.
- Payload inspector (developer mode).

## External facts verified (2026-09-13)

| Fact | Source |
|---|---|
| SheetJS official distribution is `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (latest on the CDN); the npm registry `xlsx` is 0.18.5, stale (SPEC §5) | HEAD/GET on cdn.sheetjs.com; `npm view xlsx version`; tarball `package.json` |
| SheetJS read options `cellFormula`, `cellText`, `cellDates`, `bookVBA`, `sheetStubs`, `dense`, `sheetRows`; ESM `xlsx.mjs` with bundled types | `types/index.d.ts` in the 0.20.3 tarball |
| DuckDB-WASM stable 1.32.0 (npm `latest` tag points at a dev build); package exports browser and Node blocking targets; `createDuckDB(bundles, logger, NODE_RUNTIME)`, `registerFileBuffer`, `connect().query` — smoke-tested in Node with `read_csv` | npm `@duckdb/duckdb-wasm@1.32.0` type declarations; local smoke test |
| Tally pre-defined groups: 15 primary (Branch / Divisions, Capital Account, Current Assets, Current Liabilities, Direct Expenses, Direct Incomes, Fixed Assets, Indirect Expenses, Indirect Incomes, Investments, Loans (Liability), Misc. Expenses (ASSET), Purchase Accounts, Sales Accounts, Suspense A/c) — 9 Balance Sheet, 6 P&L; 13 sub-groups with parents (Bank Accounts→Current Assets, Bank OD A/c→Loans (Liability), Cash-in-hand→Current Assets, Deposits (Asset)→Current Assets, Duties & Taxes→Current Liabilities, Loans & Advances (Asset)→Current Assets, Provisions→Current Liabilities, Reserves & Surplus→Capital Account, Secured Loans→Loans (Liability), Stock-in-hand→Current Assets, Sundry Creditors→Current Liabilities, Sundry Debtors→Current Assets, Unsecured Loans→Loans (Liability)) | https://help.tallysolutions.com/docs/te9rel66/Creating_Masters/Accounts_Info/p.htm (Tally.ERP 9 help; the TallyPrime groups page https://help.tallysolutions.com/tally-prime/accounting/groups-in-tallyprime/ confirms 15 primary + 13 sub-groups but does not enumerate them — R-08 stays open for an in-product check) |

**Not verified and therefore not written:** TallyPrime export menu paths (R-07); help pages carry
structure with paths marked `TODO(review)`.

## Tests

- Unit: header detection, type inference (day-first, Indian grouping, parentheses, Dr/Cr), CSV
  sniffing, zip-bomb guard, every Tally quirk, hierarchy + subtotal checks, each redaction detector
  with positive, negative and false-positive cases (invoice numbers, amounts), token stability and
  collision rate.
- Property: subtotal rows never double-counted; parsed TB totals equal generated totals.
- Integration: every fixture (clean and messy) parses to ground truth through SheetJS and
  DuckDB-WASM; broken variants produce the expected findings.
- Performance: 50 MB xlsx through the worker pipeline in a real browser under 60 s (Playwright).
