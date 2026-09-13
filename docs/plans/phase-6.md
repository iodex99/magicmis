# Phase 6 — Jobs, Excel output, lifecycle

Scope from SPEC §34:

> - Job state machine with charge points and checkpoints; diagnostic, setup and refresh flows; drift
>   detection and restructure pricing.
> - Monthly Financial MIS template; Excel generator (report, Checks, Data, Lineage) with V11; lineage
>   panel.
> - Company lifecycle and memory fee billing; notifications.
> - *Acceptance:* E2E setup then refresh with zero AI calls on matching fixture; failure classes bill
>   exactly per Section 23; Excel formulas verified.

## Plan

### `packages/templates`
- Template spec schema (Zod).
- Built-in Monthly Financial MIS template.
- Sections are omitted when their data is missing, and the omission is noted in Checks.

### `packages/render-excel`
- ExcelJS workbook with these sheets:
  - Cover
  - Index
  - one report sheet per section
  - Checks
  - Data
  - Lineage
- Report cells use SUMIFS formulas and store cached values.
- Number formats follow Indian digit grouping.
- File names follow SPEC §24.1.
- V11 has two sides:
  - an evaluator that runs in the browser;
  - a HyperFormula oracle that runs in tests only.

### `packages/jobs` (server)
- Job lifecycle:
  - state machine with forward-only transitions;
  - create / estimate / quote / reserve;
  - heartbeat;
  - encrypted stage checkpoints.
- Settlement:
  - completion at the price of the tier delivered;
  - data-fault and platform-fault charges;
  - cancel;
  - review expiry with reminders.
- Drift detection.
- Company lifecycle:
  - memory fee;
  - grace, archive, restore and purge;
  - refresh reminders.
- Supabase Storage adapter.

### `packages/pipeline` (browser)
- Preflight with party tokenisation.
- Cascade.
- Compute and validation.
- Workbook with V11.
- Snapshot and blueprint payloads.

### `apps/web`
- Pages: companies, company history, setup and refresh runner.
- Pipeline Web Worker.
- Mapping review during the job.
- API routes:
  - companies, session, restore;
  - jobs and their actions;
  - AI stages;
  - completion;
  - output download.
- Server helpers for the key wrapper and the output store.

### `apps/worker`
- Jobs sweep.
- Memory fee.
- Lifecycle notices and purge.
- Refresh reminders.
- Emails for each job and lifecycle event.

### Migrations
- **0021**:
  - reservations may belong to a company fee;
  - `company_fee_charges`;
  - lifecycle columns and output metadata;
  - job and lifecycle configuration.
- **0022**: output upload cap.

## Summary (2026-09-13)

**Acceptance (SPEC §34): met.**

| Criterion | Evidence |
|---|---|
| E2E setup then refresh with zero AI calls on a matching fixture | **Node:** `packages/jobs/test/flow.test.ts` runs 13 months of setup, then a refresh, through the production pipeline against real Postgres. The refresh maps everything by company rule, skips review, passes V7 and V11, and captures exactly the refresh price. `ai_calls` is 0 for both jobs. **Browser:** `apps/web/e2e/mis.spec.ts` runs the same flow through the UI (Chromium, local Supabase). The downloaded workbook opens and shows rehydrated names. `ai_calls` is 0. The wallet balance is 20,000 − 999 − 299. |
| Failure classes bill exactly per Section 23 | `packages/jobs/test/charges.test.ts` covers each outcome in 12 tests: completed; delivered lower tier; data fault in preflight and later; platform fault with absorbed cost; browser platform-fault limit; cancel before and after AI; review expiry with a reminder; capture capped at the hold; quote over cap; insufficient credits. Every price is read from the price book. |
| Excel formulas verified | `packages/render-excel/test/workbook.test.ts`: for each of three companies, HyperFormula and the V11 evaluator evaluate every formula cell and match the engine (money to the paisa). A tampered formula fails V11. The file is written and re-read. |

**Tests added:**

| Package / suite | Tests |
|---|---|
| templates | 2 |
| render-excel | 6 |
| jobs: charges | 12 |
| jobs: lifecycle | 5 |
| jobs: flow | 1 |
| pipeline | 4 |
| engine: account rules | 1 |
| web E2E | 2 |

The worker template test now covers 14 more types. The whole web E2E suite passes: 14 tests.

**Defects found and fixed:**
- **HyperFormula wildcard handling:** `|` in SUMIFS criteria acted as regex alternation. Head paths now use `/`.
- **Guarded division:** our evaluator took both IF branches eagerly. It now parses to an AST and evaluates IF lazily.
- **Implied-zero movement:** the Excel Data sheet was missing implied-zero rows that carry movement.
- **Wallet sweeper:** it would have released review and AI-touched job holds without the cancellation fee.
- **Display names in the workbook:** the Data sheet showed normalised ledger keys instead of rehydrated names. The E2E test caught this.
- **Price-book test:** it was clock-skew sensitive and now inserts an explicitly past `effective_from`.

**New dependencies:**
- `exceljs` 4.4.0 (MIT): the Excel writer named in SPEC §5.
- `hyperformula` 3.4.0 (GPL-3.0-only): **test-only** V11 oracle, never bundled.
- `@supabase/supabase-js` 2.116.0 in the worker: the same SDK as the web app, used for output storage on purge.

**Known issue:** the wallet property/concurrency suite failed once under a full parallel run and passed on rerun, as noted in Phase 3.

**TODO(review) raised:**
- **R-34:** HyperFormula licence choice if in-browser V11 ever needs more than our evaluator.
- **R-35:** verify the lakh/crore number formats render correctly in Excel and LibreOffice.
- **R-36:** first memory-fee timing, output retention days, and the deletion purge delay.
