# Phase 5 — Semantic layer, mapping, engine, validation

Scope from SPEC §34:

> - Canonical MIS schema, Tally group seed, normalisation, mapping cascade, review UI.
> - Recipe DSL and compiler, metric library, metric store and lineage, validation checks V1–V10,
>   snapshots.
> - *Acceptance:* fixtures produce correct metrics to the paisa; each validation check proven with
>   failing fixtures; unmapped never dropped.

## Where things run

SPEC §2.8 and §7 put raw data in the browser, so the engine does too:
- Mapping, compute, metrics and validation run in the browser worker.
- They use DuckDB-WASM plus bigint arithmetic in `packages/semantic` and `packages/engine`.
- Both packages are pure TypeScript with no Node APIs.
- Tests run the same code against DuckDB's Node blocking bindings (same package and version).

The server stores only encrypted blueprints and snapshots (SPEC §9, §20). That storage lives in
`@magicmis/engine/server`, which is `server-only`.

## Design

### `packages/semantic`

**Canonical schema (`heads.ts`)**
- The schema is a versioned tree:
  - Schedule III Division I P&L and balance sheet.
  - Management heads: revenue split, direct costs, employee cost, other opex by nature, D&A, finance cost, tax.
  - The always-present `UNMAPPED`.
- Each head has a code, parent, name, statement, Schedule III reference, normal balance, sort order and **class**. The classes are:
  - income
  - direct_cost
  - indirect_cost
  - equity_liability
  - asset
  - memo
- The class is the gross-profit and statement boundary that a mapping must not cross.
- Migration 0020 seeds `mis_heads` from this list, and a test proves the seed and the TypeScript match.

**Normalisation (`normalise.ts`)**
- Steps, in order:
  1. Lowercase.
  2. Change `&` to "and".
  3. Strip punctuation and extra spaces.
  4. Expand abbreviations from the maintained list in `abbreviations.ts`.
  5. Remove trailing numeric suffixes and dates.
- Idempotent (property test).

**Tally group defaults (`tally-defaults.ts`)**
- Each of the 28 predefined groups maps to a default head.
- Suspense A/c maps to `UNMAPPED`, so suspense is always visible.

**Global library seed**
- About 150 normalised names and aliases for common Indian ledger names, each with a head.
- Seeded into `global_mapping_library` with `source='seed'`.

**Cascade (`cascade.ts`)**, per ledger. The first match wins:
1. Company rule, exact normalised name (from the current blueprint). Source `company_rule`.
2. Account rule. Source `account_rule`.
3. Global library exact match on the normalised name (`global_exact`), then alias match (`global_alias`).
4. Group default. The ledger's path is walked from the nearest group upward:
   - the first custom group whose name matches the library exact or by alias gives the head;
   - otherwise the nearest predefined ancestor's default gives it.
   - Source `group_default`, not needing review.
5. Fuzzy library match at or above `semantic.fuzzy_threshold` (trigram Dice), marked `needs_review`.
   - When a group default exists, the fuzzy match is used only if it refines that default: same class, and a descendant of the default head.
6. Otherwise the ledger is **unmatched** and becomes input to `mapLedgers` (AI, `needs_review`).
   - AI mappings are checked against the group class too.
   - Anything still unmatched maps to `UNMAPPED`.

A library hit (steps 1–3) whose class differs from the group's class is **not** applied: Tally's
Direct/Indirect and balance-sheet placement is the accountant's decision. The group default is used
instead and the row is flagged for review.

Every mapping records its source, confidence (high/medium/low) and `needs_review`.

**Blueprint rules (`rules.ts`)**
- Company rules and account rules are Zod schemas.
- Write-back: confirmed mappings become company rules in the next blueprint version.
- Promote to account rules ("apply to all my companies").
- Global library promotion is admin-reviewed only. Candidate generation and the admin queue arrive with the admin console (Phase 9; R-31).

**Review model (`review.ts`)** is a pure state machine for SPEC §19. It supports:
- grouping by head
- filters: needs review, unmapped, by head, by source
- search
- bulk reassign
- "apply to all my companies"
- confirmation gating: blocked while needs-review rows remain, unless they are accepted as proposed
- refresh mode, which shows only new, changed or previously unmapped ledgers and auto-skips when there are none

### `packages/engine`

**Recipe DSL (`recipe.ts`, Zod)** declares:
- sources: fingerprint, sheet, role — `trial_balance`, `group_summary`, `profit_and_loss`, `balance_sheet`, `day_book`, `sales_register`, `purchase_register`, `bills_receivable`, `bills_payable`, `stock_summary`, `pay_sheet`
- column bindings by header text
- sign convention
- filters: excluded ledgers or groups, with reasons
- mapping rules: a reference to the blueprint rules
- period definition: FY start month, monthly granularity
- dimensions: party, from registers
- metrics: library IDs and parameters

It is data. AI never writes SQL.

**Facts (`facts.ts`)**
- Parsed Tally reports become normalised rows:
  - `ledger_facts`: ledger key, name, group path, period, opening, debit, credit, closing in paise, source reference.
  - `txn_facts`: date, voucher type and number, ledger, party, amount, source reference.
- A P&L ledger's month movement comes from debit − credit when present. Otherwise it is the closing difference within the financial year, with the FY restart applied.

**Compiler (`compile.ts`)**
- Turns a recipe into DuckDB SQL: typed tables for facts and mappings, head × period totals, rollups to parents, coverage counts, and transaction dimension totals.
- Identifiers are generated, never taken from user text.
- Literals are escaped.
- Every aggregate is `CAST(SUM(..) AS VARCHAR)`, so values reach JavaScript as exact strings.

**Runner (`run.ts`)** executes the compiled SQL on a `DuckConn` (the Phase 3 interface) and returns a `HeadCube`.

**Metric library (`metrics/`)** uses bigint paise and exact decimals, with division rounded half-even to 6 places. Each metric returns a value or an explicit null with a reason (`zero_denominator`, `missing_data`, `no_prior_period`). The metrics are:
- **P&L:** revenue; direct costs; gross profit and GP%; employee cost and %; other opex; other income; EBITDA and %; D&A; finance cost; PBT; tax; PAT and PAT%.
- **Period comparisons:** MoM (abs, %); YoY vs the same month last year; YTD and LY-YTD; variance vs the previous period.
- **Drivers:** top contributors to change by dimension, sorted by absolute contribution.
- **Working capital:** receivables; payables; inventory; DSO, DPO and inventory days (days in period); cash conversion cycle; current ratio; quick ratio; working capital.
- **Ageing:** buckets from bill dates, with the bucket list from config.
- **Payroll:** headcount; gross pay; employer PF/ESI where those columns exist; cost by designation.

EBITDA definition (ADR 0020): revenue − direct costs − employee cost − other opex. Other income is excluded and added back between EBITDA and PBT.

**Metric store (`store.ts`)** — each value records:
- metric_id, period, dimension keys
- value (decimal string or null) and null reason
- unit
- formula text
- inputs: metric IDs or source references (fingerprint, sheet, column, filter, row count)
- engine_version, computed_at

`lineage(metricId)` walks it from source to calculation to result.

**Validation (`validation/`)** covers V1–V10 per SPEC §21. Each check returns:
- id
- severity
- failure class
- a plain-language message with the fix
- aggregate amounts only

The checks:
- **V1** coverage: fact rows and sums reconcile to heads plus Unmapped; Unmapped non-zero is blocking unless accepted.
- **V2** source statement total equals MIS total.
- **V3** TB debits equal credits (`validation.tb_tolerance_paise`).
- **V4** group subtotals.
- **V5** balance sheet equation.
- **V6** profit reconciles to the P&L A/c movement.
- **V7** continuity against the previous snapshot's closings, by ledger.
- **V8** period completeness and duplicates.
- **V9** duplicate transactions across files.
- **V10** sign sanity.

V11 and V12 arrive with Excel output and commentary.

**Snapshots**
- `snapshot.ts` defines the browser-side payload schema: ledger × period balances with tokenised keys, the metric store and the validation results. The cap is `ai.payload_caps` snapshot bytes.
- `@magicmis/engine/server` does the storing:
  - company DEK create and unwrap (envelope, ADR 0008)
  - `storeSnapshot`, which always creates a new version
  - `latestSnapshot`
  - `storeBlueprint`, which is versioned and hash-chained
  - `latestBlueprint`

### `apps/web`

- `MappingReview` component on the review model: table grouped by head, filters, bulk reassign, keyboard navigation, confirm. It renders inside a paid job in `awaiting_review`, so it is wired into job pages in Phase 6. SPEC §2.3 forbids showing mappings outside a paid action.

## Tests

- **Fixtures to the paisa.** Every company × month trial balance goes through parse, cascade, compile, DuckDB and metrics. Each metric must equal an independent calculation from the generator's ledger × month truth, using a hand-written expected head per fixture ledger.
- **Unmapped never dropped:**
  - property test: the sum over heads including Unmapped equals the sum over facts, for random mappings and ledgers;
  - V1 fails when a mapping row is removed.
- **Each validation check fails on a failing fixture:**
  - broken variants: unbalanced TB → V3, subtotal mismatch → V4, duplicate period and missing month → V8, backdated change → V7;
  - constructed mutations for V1, V2, V5, V6, V9 and V10.
- **Cascade:** precedence, class guard, fuzzy threshold, party ledgers, suspense.
- **Normalisation:** property tests.
- **Review model:** gating and refresh mode.
- **Recipe:** schema tests and compiler injection safety.
- **Snapshot and blueprint storage:** new versions only, decrypts only with the right company context, hash chain.

## Summary (2026-09-13)

**Acceptance (SPEC §34): met.**

| Criterion | Evidence |
|---|---|
| Fixtures produce correct metrics to the paisa | `packages/engine/test/metrics.test.ts`. All 42 clean monthly trial balances (3 companies × 14 months, including a financial-year boundary) go through SheetJS → header detection → Tally parser → facts → mapping cascade (no AI needed) → DuckDB-WASM → metric library. The test compares 24 metrics per month (money, margins, ratios, DSO) with figures computed independently from generator ground truth by Tally group. It also checks YTD across the FY boundary, MoM and YoY. Six messy layouts, five of them closing-only, reproduce revenue, PBT and receivables from closings. |
| Each validation check proven with failing fixtures | `test/validation.test.ts`. Every check passes on clean data. The broken generator variants fail as follows: unbalanced TB → V3 and V5; subtotal mismatch → V4; duplicate period and missing month → V8; backdated change → V7, flagged as a restatement. Mutations prove V1 (unmapped and lost rows), V2 (a ledger that never reaches a head), V6 (P&L statement mismatch), V9 (vouchers in two files) and V10 (revenue booked to an expense head). |
| Unmapped never dropped | A property test drops random subsets of mappings and checks three things: the closing sum across BS + PL + Unmapped equals the source, every ledger is counted exactly once, and V1 still reconciles. A row lost to an invalid head is a `platform_fault`. |

**Tests added:**
- semantic 22
- engine 30: metrics 9, validation 11, store/analysis/schemas 6, encrypted storage 4 against Postgres

**Built**

- `packages/semantic`:
  - canonical heads with classes
  - normalisation and abbreviation list
  - Tally group defaults
  - global library seed
  - Dice-trigram fuzzy match with an exact threshold comparison
  - class-guarded cascade with AI hand-off
  - mapping rules and write-back
  - mapping review model
  - SQL seed generator
- `packages/engine`:
  - recipe DSL
  - facts from Tally reports
  - DuckDB compute, with an implied-zero grid and FY-aware movement
  - metric library, comparisons, driver analysis, ageing and payroll
  - metric store and lineage
  - validation checks V1–V10 with the gate outcome
  - snapshot payload schema with its size cap
  - server-only encrypted blueprint and snapshot storage with a blueprint hash chain
- `apps/web`: `MappingReview` component (filters, bulk reassign, keyboard navigation, confirmation gating). Wired into jobs in Phase 6.
- Migration 0020:
  - `mis_heads.class`
  - generated head and library seed
  - `semantic.*`, `validation.*` and `engine.ageing_buckets` config
- ADR 0020.

**Defects found by fixtures and fixed:** Tally leaves zero cells blank. Inside a column the report has, a blank now reads as 0, not unknown. Before the fix, P&L movement was null in the parent-column layout.

**New dependencies:** none beyond workspace packages. The engine uses the existing DuckDB-WASM, `pg`, `server-only` and `@magicmis/crypto`.

**TODO(review) raised:**
- R-31: library promotion queue (Phase 9)
- R-32: metric conventions for CA review
- R-33: heads, Schedule III references, abbreviations, library seed and fuzzy threshold
