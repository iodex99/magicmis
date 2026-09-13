# Phase 7 — Dashboard, commentary, reference MIS recreate

Scope from SPEC §34:

> - Dashboard spec, renderer, filters, lineage clicks; JSON Patch editing with versions and undo.
> - Commentary facts pack, placeholders, post-check (V12), batch and instant delivery.
> - Reference MIS layout extraction and binding review.
> - *Acceptance:* post-check rejects injected numerals; batch path completes and notifies; recreated
>   template renders a fixture MIS layout correctly.

## Plan

### Commentary (`packages/engine`, `packages/ai`, `packages/jobs`)
- Facts pack from the stored snapshot:
  - metrics with IDs;
  - month-on-month and year-on-year variances above materiality;
  - validation warnings.
- `checkCommentary` (V12):
  - every placeholder resolves;
  - no digits outside placeholders or the configured allowlist;
  - no currency signs.
- `generateCommentary` stage:
  - uses V12 as its check, with one repair;
  - a second failure is a platform fault.
- Delivery:
  - Standard: Message Batches via a worker task; items that fail go to a real-time rerun.
  - Instant: runs in the request.
- Completion captures and notifies.

### Dashboard (`packages/render-dashboard`, `packages/jobs`, `apps/web`)
- Zod dashboard spec and a default dashboard.
- RFC 6902 patch engine with a prototype-key guard and schema re-validation.
- Widget views: ECharts options plus lineage keys. KPI and table views.
- Commentary renderer that checks again in the browser.
- Dashboard add-on job.
- Patch preview, apply and undo, each stored as a blueprint version.
- Pages: dashboard (filters, edit controls, lineage panel) and commentary (order, read).

### Reference MIS recreate (`packages/ingest`, `packages/templates`, `packages/ai`, `packages/render-excel`, `apps/web`)
- Layout extraction in the browser with ExcelJS, then redaction.
- Metric catalogue with label synonyms.
- Binding:
  - deterministic rules first;
  - subtotal rules from formulas;
  - `extractReferenceLayout` for the rows left over.
- `subtotal` template rows, rendered as cell arithmetic and verified by V11.
- Recreated template builder.
- Combined price: setup plus add-on.
- Server binding route with a checkpoint.
- Binding review UI.
- Stored template reused on refresh.
- Fixture reference MIS with ground truth.
- Acceptance test.

## Summary (2026-09-13)

**Acceptance (SPEC §34): met.**

| Criterion | Evidence |
|---|---|
| Post-check rejects injected numerals | `packages/engine` commentary tests (12). The check rejects digits in any script, unknown IDs, malformed braces and currency signs, and lets allowlisted phrases through. In `packages/jobs/test/commentary.test.ts`, an output with "12% to ₹7.4 crore" gets a repair turn that carries the problems; a second failure is a platform fault with nothing charged or stored. The browser re-check is covered in `render-dashboard/test/views.test.ts`. |
| Batch path completes and notifies | `packages/jobs/test/commentary.test.ts`, run against real Postgres with a scripted transport. Two queued jobs go out as one batch, with the facts pack as data and a JSON-schema output format. Polling while in progress completes nothing. When the batch ends, both jobs capture the price and write a `job.completed` notification. The failing item is rerun in real time and repaired. `ai_calls` shows the batch and real-time rows. |
| Recreated template renders a fixture MIS layout correctly | `packages/render-excel/test/recreate.test.ts`. The synthetic reference MIS is extracted with no value in the layout and bound by rules plus a scripted AI answer (a bad AI metric is rejected). The template matches the ground truth row by row: kind, metric, subtotal terms, bold, indent and column order. It is rendered from real trading-company compute. Sheet order, labels and bold match the reference, and unavailable rows carry the note and no number. Every figure and subtotal matches the engine in HyperFormula and V11 (money to the paisa). **Browser:** `apps/web/e2e/mis.spec.ts` sets up a company with a reference MIS through the UI: price 1,498, binding review with a user change, workbook with the reference's sheets, zero AI calls. |

**Also delivered and tested:**
- **Dashboard add-on:** captures the price, stores the default dashboard, and is idempotent.
- **Patches and undo:**
  - preview stores nothing;
  - apply creates new versions;
  - undo walks back step by step;
  - invalid patches, prototype keys and stale versions are refused.
- **Restructure** keeps the dashboard.
- **Dashboard refresh:** new months reach the dashboard only through a paid `dashboard_refresh`, and edits and undo keep the month.
- **Web E2E, dashboard:**
  - add-on bought through the UI;
  - lineage panel opened from a KPI;
  - rename previewed, applied and undone;
  - four blueprint versions;
  - zero AI calls.
- **Reference setup pricing:** captures setup plus add-on, including on completion.
- **Evals:** datasets and replay runs for `reference_layout` and `commentary`.

**Tests added:**

| Package / suite | Tests |
|---|---|
| engine: commentary | 12 |
| render-dashboard | 34 |
| jobs: commentary | 3 |
| jobs: dashboard | 7 |
| jobs: charges | 1 |
| templates: reference | 3 |
| ingest: reference layout | 19 |
| render-excel: recreate and catalogue | 2, plus one assertion |
| ai: units and evals | 6 |
| web E2E | 2 |

Web E2E: 15 of 16 pass in a full run. The exception is `wallet.spec` "proforma", which was refused by the app's own sign-up rate limit ("Too many sign-up attempts from this network") after repeated local runs created many accounts from one IP inside the limiter's window. No Phase 7 code touches that flow.

**Defects found and fixed:**
- ExcelJS returns `undefined` for `font` and `alignment` on unstyled cells, despite typings that say they are always present.
- A `FactsPack` readonly/brand type mismatch between the engine and the AI schemas.
- The AI surface test did not know the new stage functions.
- An eval dataset relabelled rows without updating subtotal term references.
- An E2E query matched companies left over from earlier local runs.

**New dependencies:**
- `echarts` 6.1.0 (Apache-2.0): the dashboard renderer named in SPEC §5.
- `exceljs` 4.4.0 in `@magicmis/ingest` and the fixture generator: styled reading and writing of a reference MIS (already used by `render-excel`).

**TODO(review) raised:**
- **R-37:** the commentary digit allowlist (`commentary.digit_allowlist`).
- **R-38:** a human review of commentary prose on synthetic facts before activation.
- **R-39:** the metric label synonyms used for reference binding, and header period patterns.
- **R-40:** policy that UI layout edits to a paid dashboard are uncharged.
- **R-41:** the reference MIS limits (20 sheets, 400 rows, 60 columns) and extraction heuristics for label column and header row.
