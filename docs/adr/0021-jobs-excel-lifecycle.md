# ADR 0021 — Jobs driven by the browser, charges settled by the server, formulas verified without a bundled spreadsheet engine

**Status:** accepted · **Date:** 2026-09-13 · **Phase:** 6

## Context

The relevant SPEC sections are §2.3, §2.8, §21, §23, §24.1, §28 and §29. Together they require:

- The pipeline runs on data that never leaves the browser.
- Charges follow a fixed table of outcomes.
- The Excel workbook recalculates in Excel and is verified against the engine (V11).
- Companies pay a monthly memory fee, with grace, archive and purge.

## Verified facts (2026-09-13)

| Fact | Source |
|---|---|
| `exceljs` 4.4.0, licence MIT. API used: `Workbook`, `addWorksheet(name, { views, pageSetup })`, `getCell(r, c).value = { formula, result }`, `numFmt`, `xlsx.writeBuffer()`. Page setup uses `paperSize` 9 (A4), `orientation`, `printTitlesRow` and `fitToWidth`. | `npm view exceljs`; package `index.d.ts` |
| `hyperformula` 3.4.0, licence **GPL-3.0-only**. `HyperFormula.buildFromSheets(sheets, { licenseKey: "gpl-v3" })`, `getSheetId`, `getCellValue({ sheet, row, col })`. | `npm view hyperformula`; package typings |
| HyperFormula turns SUMIFS wildcards into regular expressions **without escaping** `\|`, so `"*\|REV\|*"` matched every row. Excel treats the character literally. | Observed in `packages/render-excel` tests |
| `@supabase/storage-js` 2.116.0: `from(bucket).upload(path, body, { contentType, upsert })`, `download(path)` (returns a Blob), `remove(paths)`, `getBucket`, `createBucket(id, { public })`. | Package `dist/index.d.cts` |
| `server-only` throws unless the `react-server` export condition is set. `tsx --conditions=react-server` sets that condition for the worker. | Package `package.json` exports; worker smoke test |

## Decisions

### 1. The browser drives stages; the server owns money and state

- `@magicmis/pipeline` runs in a Web Worker: preflight, party tokenisation, cascade, compute, validation, workbook and V11.
- The server (`@magicmis/jobs`) owns the following, re-reading the job under a row lock on every call:
  - price or quote
  - reservation
  - forward-only stage transitions
  - AI stages, with encrypted checkpoints
  - settlement
  - storage
- The browser never chooses a price, a charge or a model.

### 2. Charge points follow SPEC §23 exactly

- **Completed:** capture the price of the tier actually delivered.
- **Data fault:** capture the `data_diagnostic` price.
- **Platform fault:** release everything; record the absorbed AI cost.
- **Cancel or expiry:** capture `cancel_after_ai_fee` only if an AI call happened.
- A capture never exceeds the hold.
- The wallet sweeper leaves reservations for jobs that made AI calls or await review; the jobs sweep settles those.

### 3. Browser-reported platform faults are rate-limited

Compute happens in the browser, so a modified client could claim "our fault" to avoid paying for work it has already rendered.

- A browser report releases credits at most `jobs.platform_fault_release_limit` times per `jobs.platform_fault_window_days`.
- Beyond that limit, the job is charged as a data fault and an audit entry is written.
- Server-detected platform faults, such as AI failures, are never limited.

### 4. Excel formulas

- The Data sheet stores **integer paise**, so SUMIFS sums are exact in doubles.
- Report cells divide by 100.
- Head paths use `/` as the separator, because it is literal in Excel and in regex-based engines.
- Comparisons reference report cells, with guarded division.
- YTD uses numeric period and FY indices.

### 5. V11 without bundling a GPL engine

- HyperFormula is GPL-3.0-only, so it is a **test-only** dependency.
- In the browser, V11 uses a small evaluator (`render-excel/evaluate.ts`) that covers exactly the grammar we write: SUMIFS, IF with lazy branches, OR, ABS, arithmetic, comparison and concatenation.
- Tests require HyperFormula, our evaluator and the engine to agree on every formula cell for three companies. Money must match to the paisa.

### 6. Indian number formats

- Digit placeholders are placed around literal commas, with the pattern chosen per cell from the value's digit count.
- Conditional-section formats could not be checked here, and SheetJS's formatter does not support them.
- Rendering in Excel and LibreOffice needs manual verification (R-35).

### 7. Memory fee

- The fee is a fixed reserve-and-capture with a company as the reservation subject (migration 0021).
- It is idempotent per company-month in `company_fee_charges`.
- Setup includes the first month; the first debit falls one month after the anchor date (R-36).
- Paying arrears restores `active`. `lifecycle.grace_months` unpaid months archive the company.
- Restore charges `company_restore` plus the current month and starts a new fee cycle.
- Purge destroys the company key (crypto-shredding) and removes stored outputs.

### 8. Outputs

- Workbooks are sealed under the company data key before upload to the private `outputs` bucket.
- They are decrypted only on an authenticated download.
- `OUTPUT_STORE=local` and `KEY_WRAPPER=local` are development-only, because the local stack runs without Storage.

### 9. New packages beyond SPEC §6

- **`@magicmis/jobs`** (server) holds job orchestration, which both the web app and the worker need.
- **`@magicmis/pipeline`** (browser-safe) is shared by the web worker and the Node tests, so the E2E-tested path is the production path.

## Consequences

- **Tests prove the Phase 6 acceptance:**
  - setup then refresh with zero AI calls: a Node integration test plus a Playwright test through the UI;
  - exact billing for every failure class;
  - Excel formulas verified independently.
- **V12 (placeholders) lands with commentary** in Phase 7.
- **Mapping review during a paused runtime-cap job:** resuming needs the files again, because raw data is never persisted.
