# ADR 0022 — Dashboards as patched data, commentary behind a placeholder check, reference MIS recreated by rules first

**Status:** accepted · **Date:** 2026-09-13 · **Phase:** 7

## Context

The relevant SPEC sections are §2.3, §2.7, §22, §24.2, §25 and §34 Phase 7. They require:

- **Dashboard:**
  - built from a spec with widgets, filters and drilldown;
  - rendered with ECharts from the spec and the metric store only;
  - every number opens its lineage;
  - edits are validated JSON Patch operations, previewed, stored as blueprint versions, with undo.
- **Commentary:**
  - built from a deterministic facts pack;
  - placeholders for every quantity;
  - a post-check (V12) on the server and again in the browser;
  - Standard (batch) or Instant delivery.
- **Reference MIS, Recreate mode:**
  - the browser extracts the layout, without values;
  - `extractReferenceLayout` binds rows to metrics or subtotal rules;
  - the user reviews the bindings;
  - unbound rows stay in the template, marked "Not available from supplied data".
- **Acceptance:**
  - the post-check rejects injected numerals;
  - the batch path completes and notifies;
  - a recreated template renders a fixture MIS layout correctly.

## Verified facts (2026-09-13)

| Fact | Source |
|---|---|
| `echarts` 6.1.0, licence Apache-2.0. `EChartsOption` is exported; `init(dom, theme?, opts?)` returns `EChartsType`; `on("click", handler)` passes `ECElementEvent`, which carries `seriesIndex?` and `dataIndex`. The package `types` entry is `types/dist/echarts.d.cts`. | Package `package.json`; `types/dist/echarts.d.ts` |
| JSON Patch operations `add`, `remove`, `replace`, `move`, `copy` and `test`. `-` appends to an array. `move` may not target a child of `from`. `test` compares JSON values, so `"10"` ≠ `10`. | [RFC 6902](https://www.rfc-editor.org/rfc/rfc6902), Appendix A examples as tests |
| JSON Pointer escapes: `~1` is `/` and `~0` is `~`, decoded in that order. | [RFC 6901 §4](https://www.rfc-editor.org/rfc/rfc6901#section-4) |
| ExcelJS 4.4.0 reading API: `xlsx.load(buffer)`, `eachSheet`, `worksheet.state` (`visible` / `hidden` / `veryHidden`), `rowCount`, `columnCount`, and `getCell(r, c)` with `value`, `formula`, `numFmt`, `font`, `alignment`. The typings declare `font` and `alignment` as always present, **but unstyled cells return `undefined` at runtime**. | Package `index.d.ts`; observed in `packages/render-excel/test/recreate.test.ts` |
| SheetJS community builds do not read cell styles (bold, indent). | SheetJS docs, Community vs Pro features; this is why extraction uses ExcelJS |

## Decisions

### 1. Dashboards are data; every change is a new blueprint version

- **Spec and rendering:**
  - `@magicmis/render-dashboard` holds the Zod spec: a 12-column grid, the seven widget kinds, bindings to metric IDs, dimensions and periods, filters, and drilldown to a widget or to lineage.
  - `buildWidgetView` turns spec + metric store into an ECharts option, plus a lineage key for every point.
  - Displayed figures use the store's exact strings, rounded only at display. The chart's float copy is used for drawing only.
- **Patches:**
  - Implemented in-house to RFC 6902, with the Appendix A examples as tests.
  - Applied to a clone and never mutate the input.
  - `__proto__`, `constructor` and `prototype` keys are refused.
  - The result must re-validate against the spec schema. The schema is strict, so unknown keys such as `script` are rejected.
- **Versions and undo:**
  - The stored dashboard is `{ spec, parentVersion, dataThrough }`.
  - Apply stores the patched spec with `parentVersion` set to the version it was made from.
  - Undo stores the parent's spec with the parent's own pointer. Repeated undo therefore walks back through history instead of toggling between two versions.
  - Both require the caller's `baseVersion` to still be current (optimistic concurrency).
- **Charging:**
  - Layout edits from UI controls are not charged: they read no data, and the dashboard was already paid for.
  - Edits from chat are charged per chat message (Phase 8).
- **Months shown (`dataThrough`):**
  - A dashboard shows months up to `dataThrough`.
  - `dashboard_addon` sets it to the latest stored month.
  - A monthly refresh stores a new month for the Excel MIS, but the dashboard moves to that month only through a paid `dashboard_refresh` (SPEC §23 refresh step 5; §2.3).
  - The server filters values before sending them, so unpaid months never reach the browser.
  - Edits and undo keep `dataThrough`.
- **Restructures:** a restructure stores new template, recipe and rules, and carries the dashboard forward.

### 2. Commentary: facts pack in, placeholders out, checked twice

- The server builds the facts pack from the stored snapshot. Fact IDs are the placeholder IDs, for example `m:revenue@2026-05` and `mv:revenue.mom@2026-05:pct`.
- **`checkCommentary`** (V12):
  - rejects unknown placeholders and malformed braces;
  - rejects any Unicode decimal digit (`\p{Nd}`) left after placeholders and the configured allowlist are removed;
  - rejects currency signs.
  - It is the stage `check`, so a failure gets exactly one repair turn listing the problems. A second failure is a `platform_fault`: nothing is charged and nothing is stored.
- **Delivery:**
  - Standard: queued jobs go out as one Message Batch from the worker. Items that fail the check are rerun in real time, which includes the repair.
  - Instant: runs in the request.
- **In the browser:** `renderCommentary` runs the same check again before substituting values. Each substituted value becomes a lineage link. Party tokens are rehydrated only from files loaded in the session; otherwise the token shows with a hint.

### 3. Reference MIS: browser extraction, rules first, AI only for what rules leave

- **Extraction (`@magicmis/ingest`, ExcelJS, browser):**
  - captures sheet order, labels, bold, indent, column headers classified into period patterns, number formats, and the first value cell's formula;
  - rewrites formula cell references as row refs and removes numeric literals;
  - reads a plain signed sum (`C5+C6-C7`, `SUM(C5:C9)`) into `sumOf` terms;
  - reads no values. Hidden sheets are listed and skipped.
  - Sheet names, headers and labels go through the session redactor before leaving the browser. Party names are registered first, from the loaded books.
- **Binding (`@magicmis/templates`):**
  - The server rebinds by rules itself, so the browser's word is never taken.
  - Rules: a metric catalogue of labels and synonyms; then formula subtotals whose terms are money rows; then value-less rows as headings.
  - Only unbound rows go to `extractReferenceLayout`. Its check requires one answer per unbound row, allowed metric IDs, and same-sheet subtotal terms that are not the row itself.
  - AI proposals that still do not check out stay unbound.
  - Subtotals are resolved again after every merge, so a subtotal waiting on an AI-bound term becomes a rule subtotal.
  - Bindings are checkpointed per job.
- **Subtotal rows:** the template spec gains a `subtotal` row kind, a signed sum of rows above it in the same section. The renderer writes cell arithmetic plus the usual guarded comparisons, with expected values in bigint, so V11 covers subtotals too.
- **Review and build:**
  - The user reviews every row. Unbound rows become `unavailable` rows, which never receive a number.
  - The template keeps sheet order, labels, headings, bold (as emphasis) and indent.
  - Columns keep the reference's order. A comparison pulls in the columns it reads if they are missing.
  - Reserved sheet names are renamed.
- **Storage and reuse:**
  - Labels are stored redacted in the blueprint; the worker rehydrates them when rendering.
  - Refreshes use the company's stored template.
  - The metric store always includes the built-in template's metrics, so dashboards and commentary work on any template.
- **Pricing:** "Added to setup" (price book). A setup with a reference MIS is job type `reference_mis_recreate`, priced at `company_setup` + `reference_mis_recreate` with both AI cost caps. The combined price is also used when capturing after a model fallback.

### 4. Evals for activation

- `reference_layout` and `commentary` have eval datasets and harness entries, so their prompt versions can pass the activation gate (R-28).
- **`reference_layout` dataset:** the fixture reference MIS, plus variants relabelled in wording the rules do not know. It is scored per unbound row.
- **`commentary` dataset:** synthetic months, scored by V12. Prose quality needs human review (R-38).

### 5. New packages and dependencies

- **New package:** `@magicmis/render-dashboard` (named in SPEC §6).
- **New dependencies:**
  - `echarts` 6.1.0 (Apache-2.0), the renderer named in SPEC §5.
  - `exceljs` 4.4.0, added to `@magicmis/ingest` for style-aware reading and to the fixture generator for writing a styled reference MIS. It is already a dependency of `render-excel`.

## Consequences

- **Acceptance tests:**
  - **Post-check rejects injected numerals:** engine unit tests, and the jobs batch test where one injected output is repaired.
  - **Batch path completes and notifies:** `packages/jobs/test/commentary.test.ts`.
  - **Recreated template renders a fixture MIS layout correctly:** `packages/render-excel/test/recreate.test.ts`, checked with HyperFormula and V11. The browser flow is covered end to end in `apps/web/e2e/mis.spec.ts`.
- **Deferred to Phase 8:** chat-driven dashboard edits reuse `patchDashboard` and the version store unchanged.
- **Label synonyms need review:** they are business vocabulary, not numbers, and live in code as data (R-39).
