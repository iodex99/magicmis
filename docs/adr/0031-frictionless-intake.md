# ADR 0031: Get the customer to a workbook — any file, tolerant recognition, warnings not refusals

**Status:** accepted · **Date:** 2026-09-17 · **Decided by** the product owner · **Amends** SPEC §15 (accepted formats), §16 (unrecognised sheets), §21/§24 (the validation gate) and the payload-inspector rule in `.claude/rules/browser-data.md`

## Context

The owner ran a setup and was stopped by _"Some sheets could not be recognised. A trial
balance with ledger names and closing balances is the one that is always needed."_ Their
direction: the system must be frictionless — produce the output from the data there is,
hand what it cannot process to Claude rather than refuse, accept every file type, make a
drag-and-drop visibly register, and remove the payload inspector.

Tracing that message found it was one of several places where the run stopped on
something a person would shrug at:

| Where | What happened |
| --- | --- |
| Any sheet detection could not place — a cover page, a notes tab | The whole job failed, even with a perfectly good trial balance beside it. |
| Sheet classification | Built as an AI stage (Phase 4) but never called; the run failed instead. |
| A trial balance whose title names no period ("As of March 31, 2026", or none) | Its balances were silently dropped. |
| Headings other than Tally's ("Account", "Account Type", "Balance", an account-code column) | The sheet was not recognised as a trial balance. |
| One row with a name and no amount (a heading in a flat export) | The fact builder threw, taking file reading down with it. |
| An AI stage that could not run (no active prompt, a routing error) | The server marked the whole job failed. |
| A trial balance out by a rounding difference, a month missing, an export's own subtotal wrong | Validation blocked delivery and charged the data-diagnostic price. |
| Only `.xlsx`, `.xlsm`, `.xls`, `.csv` | Everything else refused by extension. |
| A date column whose values prove the other order from the company setting (every US export on the Source files page, which has no company and assumes day-first) | The whole file refused (ADR 0030). On the run screen, bills were silently read the wrong way round. |
| A file that broke the reader while pricing | "Reading your files…" spun forever. |
| Drop zone | No change on screen until parsing finished; easy to think the drop missed. |

## Decision

### 1. Any file; the bytes decide what it is

`readSourceFile` (`packages/ingest/src/source.ts`) sniffs the first bytes, not the
extension, and reads:

- every format SheetJS 0.20.3 reads — xlsx, xlsm, xlsb, xls, ods, fods, Numbers,
  SpreadsheetML, HTML tables (the common "report.xls that is really HTML"), dbf, sylk;
- text tables in any common delimiter, whatever the extension (`.txt`, `.prn`, `.dat`);
- JSON arrays of records;
- **text PDFs**, rebuilt into a table in the browser (below).

The zip-bomb guard still runs for every zip-based workbook. What cannot be read without
sending the file somewhere is refused **with the reason and what to export instead**:
photographs and scans (no text without OCR), scanned PDFs, and word-processor documents.
A refused file never blocks the others in the same drop. `checkFiles` checks size and count
only.

**PDFs.** pdf.js 6.3.289 (`pdfjs-dist`, Mozilla's official distribution; 6.2.108 or later is required — GHSA-hq66-cqwq-w95j affects 5.6.83 to 6.2.107, caught by the CI audit), legacy build so
the same code runs under Node for tests. Its worker module is imported for its side effect
of registering `globalThis.pdfjsWorker`; pdf.js then parses in the current thread
(`PDFWorker#initialize` checks for it — verified in the installed `legacy/build/pdf.mjs`),
which is already our ingestion Web Worker. The PDF never leaves the tab and no extra worker
or CSP exception is needed; pdf.js no longer uses `eval` for fonts. Text items carry
positions (`getTextContent().items[].transform[4..5]`, `width`, `height` — verified in the
package's `types/src/display/api.d.ts`): strings on one baseline form a row, right edges of
numbers cluster into amount columns, and a heading that spans an amount column's right edge
joins that column. Page furniture ("Page 1 of 3", "Continued") and headings repeated on
later pages are dropped. The rebuilt grid then goes through the same header detection as
every other file, so **parsing stays header-based**; positions only rebuild the table a PDF
flattened.

**Dependency justification (working rule 10):** `pdfjs-dist` — the de-facto standard
in-browser PDF text extractor, maintained by Mozilla; there is no smaller way to read PDF
text without sending the file to a server, which SPEC §2.8 forbids.

### 2. Recognition that reads other systems' exports

- **Column vocabulary** (`packages/tally/src/columns.ts`): "Account", "Description", "GL",
  "Head" name a ledger; "Account Type", "Type", "Category", "Class" give its group;
  "Balance", "Net Balance", "Ending Balance" are the closing balance (with Dr/Cr variants);
  account codes and numbers are recognised and deliberately given no role.
- **Content inference** (`infer-balance.ts`): where headings name no amount or no ledger
  column, a mostly-text column is the ledger name and two amount columns that each row fills
  one side of are debit and credit. A sheet is taken as a trial balance **on content alone
  only when its balances net to zero** (within 0.1% or one currency unit) — that is what a
  trial balance is, and it keeps a notes page with a column of numbers out. Bounded to
  20,000 rows so a huge day book is not read twice.
- **The month** (`periodFromText`, core): from the title, then the sheet name, then the file
  name, in any common spelling — "As of March 31, 2026", "TB_Mar-2026.xlsx", "2026-03",
  "Feb'26" — dates before bare months, the latest when several appear, null rather than a
  guess. Failing all of those, the run **asks** (below).

**Dates** (amends ADR 0030's refusal): each date column is read in the order its own values
prove — `31/03/2026` can only be day-first, `03/25/2026` only month-first — and the
company's setting decides only when the values are ambiguous (`resolveDateOrder`, core). A
column proving both orders at once has no safe reading; the Source files loader keeps it as
text and the bills parser falls back to the setting. ADR 0030's concern — a wrong date
moves entries between months while every total still balances — is met more directly by
reading each column the way it is provably written than by refusing the file.

### 3. A run that does not stop on what it can work around

`prepare` (`packages/pipeline`) is per-sheet tolerant: anything that cannot be parsed is set
aside with the unrecognised sheets, and a row with a name and no amount is a heading, not a
missing balance. The run screen then:

1. **Ignores set-aside sheets while there are balances to work with**, and says how many
   were left out.
2. **Asks Claude only when no balances were found at all** — the existing
   `sheet_classification` stage, with the same redacted outbound builder every payload uses
   (title lines never sent, text redacted, 15 sample rows, 80 columns). Its answers come back
   into `prepare` as guidance; the columns are still read by §2 above.
3. **Asks for a month** for any sheet that names none, pre-filled with the month after the
   company's latest, else the latest loaded, else last month. Inside the paid action, so
   SPEC §2.3 is untouched.
4. Fails only when nothing usable exists — no balances, bills or pay sheet — with a message
   that says what to add, and no charge (platform-fault release, as before).

An AI stage that cannot run no longer fails the job server-side (the `failJob` calls in the
two AI routes are removed). The browser carries on: unmatched ledgers go to review for a
choice, a reference layout that cannot be read falls back to the standard template, and the
customer is told in one line. A quote-required pause (`needs_quote`) still stops, because
that is a price decision, not a failure.

### 4. Warnings, not refusals

`deliverWithWarnings` (`packages/pipeline/src/run.ts`) turns every **data-fault** blocking
check into a warning: V1 (unmapped balances), V3 (trial balance does not balance), V4
(export subtotals), V5 (balance sheet does not balance), V8 (missing or duplicate month).
The checks still run and still say exactly what is wrong — on the result screen under "N
things to check in your data", on the workbook's Checks sheet, and in commentary, which
already speaks to warnings. The workbook is delivered and the job settles at its normal
price.

**Platform faults still block.** A balance lost between source and report (V1
platform-fault branch) or a workbook whose formulas do not reproduce the engine's figures
(V11) mean _we_ produced something wrong, and a report we know to be wrong is never sent.
The server's completion re-check (no blocking failure in the snapshot) is unchanged.

This is the one real trade-off in this ADR: a customer can now receive a report built on a
trial balance that does not balance. It says so prominently, and a report with a stated
caveat is more useful to someone mid-close than no report. The data-diagnostic price path
remains for faults that still fail a job.

### 5. The drop zone and the payload inspector

`FileDropZone` is the one place a file enters the app — run screen, reference MIS, source
files, chat. It lifts and changes colour while a file is over it, reads "Drop to add", shows
that it is reading, and confirms with the number of files added; the whole zone is a
keyboard-operable button, and reduced-motion preferences are respected.

The developer-mode **payload inspector is removed** at the owner's direction, with its
worker method and the `developerMode` plumbing. What leaves the browser is unchanged and
still asserted by `assertNoRawIdentifiers` in the outbound builder and the redaction tests;
the inspector was a viewing aid, not a control.

## Consequences

- Pre-payment, the run screen may now say a file "couldn't be used" and why. That is about
  the file's **format** (a photo, a scan, empty), not its content, so SPEC §2.3 holds:
  recognition, mapping and findings still appear only inside the paid action.
- Ledger names bound for AI mapping now pass through `redactText` first, which matters more
  once exports from other systems — where parties are not grouped under Sundry Debtors —
  are read.
- A sheet whose month the customer supplies is reported under that month; checks V7/V8 still
  catch a continuity break or a duplicate.
- Tests: source reading (7, including a real PDF), month-from-text (12), other systems'
  trial balances (4), tolerant prepare (4), warnings policy (2), and browser acceptance
  (`e2e/frictionless.spec.ts`: a non-Tally CSV with no month, a notes file and a photo reach
  a workbook; `e2e/ingest.spec.ts`: photo refusal, a `.txt` export, a text PDF read in the
  worker under the CSP, and the drop zone's drag state).
