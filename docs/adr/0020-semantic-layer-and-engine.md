# ADR 0020 — Semantic layer and engine: class-guarded mapping cascade, browser compute, exact metrics

**Status:** accepted · **Date:** 2026-09-13 · **Phase:** 5

## Context

The relevant SPEC sections are §2.7, §2.8, §18, §20 and §21. Together they require:

- Tally ledgers mapped to a canonical schema, never silently dropped.
- Figures computed deterministically from raw data that stays in the browser.
- Every number traceable to its source.
- Validation before render, with a failure class that drives billing.

No external API is introduced in this phase:
- DuckDB-WASM 1.32.0 was verified in ADR 0017.
- Envelope encryption was verified in ADR 0008.
- The Tally group list is R-08.

## Decisions

### 1. The canonical schema is code, seeded into the database

- `packages/semantic/src/heads.ts` holds the head tree. Migration 0020 embeds SQL generated from it and from the library seed, and a test fails if they drift.
- Each head carries a **class**: income, direct_cost, indirect_cost, equity_liability, asset or memo.
- The class is the boundary a mapping must not cross. It covers the gross-profit line and the balance-sheet side.

### 2. How the cascade uses Tally's placement

1. Company rules come first. They are keyed by the ledger's full group path plus its name, so two "Security Deposit" ledgers under different groups stay distinct.
2. Account rules and the global library (exact, then alias) are next, matched by normalised name.
3. A rule or library head whose class differs from the ledger's group class is **not applied**. The group default is used instead and the row is flagged for review.
4. The group default comes from the nearest custom group named in the library, else the nearest predefined group.
5. A fuzzy match refines the group default only within the same section, and always needs review.
6. AI runs only for ledgers with no group information.
7. Anything still unmatched goes to Unmapped.

On the fixtures, every ledger of all three companies maps without AI.

### 3. Engine in the browser, exact everywhere

- Facts and mappings load into DuckDB through registered CSV text, and the SQL is fixed text. No user text and no AI output ever becomes SQL.
- Aggregates leave DuckDB as `VARCHAR` and are parsed to bigint.
- Metrics use bigint paise. Ratios, percentages and days are 6-decimal strings using half-even division.
- A zero denominator or missing data gives an explicit null with a reason.

### 4. Monthly movement

- Tally's P&L closings are cumulative from the start of the financial year. A P&L ledger's movement for a month is therefore its closing minus the previous month's closing in the same FY, and 0 at FY start.
- A ledger missing from a loaded month is an **implied zero**, because closing-only exports omit nil balances. Implied rows count towards movement but never towards coverage.
- A head's movement is null if any contributing ledger's movement is unknown.

### 5. Metric conventions

- EBITDA = revenue − direct costs − employee cost − other opex.
- Other income is added between EBITDA and PBT.
- DSO, DPO and inventory days use the month's flow and the calendar days in that month.
- YTD percentages are recomputed from YTD components, never summed.

These are presentation conventions for review (R-32).

### 6. Validation

- **V1** compares row counts and closing sums between source facts and heads (including Unmapped).
  - A lost row is a `platform_fault`.
  - A non-zero Unmapped balance is a blocking `data_fault` unless accepted.
- **V2** compares the grand-total row of the Tally export with the balances that reached a valid head.
- **V7** flags a backdated change (a stored period's closings changed) as a restatement, as well as opening ≠ previous closing.
- **Failure class:** `gateOutcome` lets a platform fault outrank a data fault, so the customer is never billed for our error.

### 7. Company memory storage

`@magicmis/engine/server` is server-only:

- The company DEK is created on first use and destroyed on purge. After that, every read and write throws.
- Each encrypted column binds its own context (account, company, purpose, version, period).
- Snapshots are always new versions.
- Blueprints are hash-chained over digests of their plaintext parts, and verification recomputes the chain.

### 8. Deferred

- **Global library promotion** (the admin queue, where N distinct accounts form a candidate) goes to Phase 9 (R-31).
  - Account rules are stored encrypted, so counting candidates will need a keyed digest of the normalised name.
- **Mapping review** is a pure model in `packages/semantic` plus a React component. It is wired into paid job pages in Phase 6, since SPEC §2.3 forbids showing mappings outside a paid action.

## Consequences

- The metric test runs all 42 clean monthly trial balances through SheetJS, the Tally parser, the cascade, DuckDB and the metrics. It matches ground truth to the paisa, as does P&L movement from closing-only layouts.
- Heads are schema, not business numbers. Thresholds, ageing buckets, tolerances and sign-sanity heads are in `app_config`.
