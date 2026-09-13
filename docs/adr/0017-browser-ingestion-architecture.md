# ADR 0017 — Browser ingestion: neutral grid, SheetJS from its CDN, self-hosted DuckDB-WASM

**Status:** accepted · **Date:** 2026-09-13 · **Phase:** 3

## Context

SPEC §2.8, §15, §16, §33: raw files never leave the browser; parsing runs in Web Workers;
header-based parsing with day-first dates and Indian amounts; Tally quirks; DuckDB loading with
provenance; 50 MB xlsx parsed and loaded in under 60 seconds.

## Decisions

1. **A neutral `Grid`** (value, formatted text, merges, hidden rows/sheets, outline levels) is the
   only input to header detection, type inference and the Tally parsers. The same code runs in the
   browser worker and in Node tests, so the fixture round-trip test exercises production logic.
2. **SheetJS 0.20.3 from `cdn.sheetjs.com`** (pinned tarball in `package.json`; the npm registry
   copy is stale at 0.18.5). Read options: `cellFormula: false`, `bookVBA: false`, `cellText`,
   `cellNF`, `dense`, and **`cellStyles: true`** — verified in the 0.20.3 source that row
   properties (`hidden`, `outlineLevel`) are parsed only under that option. Dense rows can contain
   holes; readers use `Array.from`, never `map`, so holes cannot surface as undefined rows (a
   defect the fixtures caught).
3. **Zip-bomb guard before parsing**: the xlsx central directory is read (entry count, declared
   uncompressed total, ratio) against config limits; ZIP64 is refused. Offsets verified against
   PKWARE APPNOTE.TXT.
4. **DuckDB-WASM 1.32.0** (the npm `latest` tag points at a dev build). Browser: `AsyncDuckDB` in
   its own worker, with `.wasm` and worker scripts **copied from the installed package to
   `/vendor/duckdb` at build time**, so no third-party code loads at runtime. Tests: the Node
   blocking bindings of the same package and version. The loader writes normalised values
   (ISO dates, integer paise) as CSV into a registered in-memory file and reads it with explicit
   column types, plus `_file_id`, `_sheet`, `_source_row`.
5. **Type inference on a 10,000-row sample**, with non-blank counts over every row. Full-cell
   inference made profiling 12 s of a 47 s run at 600k rows; sampled, 0.4 s at 370k rows.
6. **Two-level headers require a parent label spanning two sub-labelled columns.** Without that
   rule the first party-heading row of a bills report was absorbed into the header (found by the
   fixtures).
7. **Report detection** by title rows first, header vocabulary second; unrecognised sheets are
   `generic` and never guessed.
8. **Sign conventions are never guessed.** Debit/Credit columns or explicit Dr/Cr suffixes decide
   the side; an unsigned single-column balance is a finding.
9. **Session hygiene**: the worker holds all parsed data; clearing terminates it (dropping DuckDB)
   and removes OPFS temp. Triggers: sign-out, "Clear session data", a tab belonging to a new
   session, and `pagehide`.

## Evidence

- 578 generated fixture files (3 companies × 14 months, clean, messy for every SPEC §16 quirk,
  broken variants) parse to ground truth; broken variants are detected.
- Chromium E2E: a 50.4 MB workbook (370,004 rows) parsed and loaded into DuckDB in 16–18 s.

## Verifying documentation

| Fact asserted | Source | Verified on |
|---|---|---|
| SheetJS official build 0.20.3 on cdn.sheetjs.com; registry `xlsx` 0.18.5 | CDN GET, `npm view xlsx version`, tarball `package.json` | 2026-09-13 |
| SheetJS read options; `!rows` hidden/outlineLevel parsed under `cellStyles` | 0.20.3 `types/index.d.ts`, `xlsx.mjs` `parse_ws_xml_data` | 2026-09-13 |
| ZIP EOCD and central directory header layout | https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT §4.3.12, §4.3.16 | 2026-09-13 |
| DuckDB-WASM 1.32.0 exports; `AsyncDuckDB(logger, worker)`, `instantiate`, `registerFileText`, `dropFile`, `connect().query`, `selectBundle`; Node blocking `createDuckDB` | `@duckdb/duckdb-wasm@1.32.0` type declarations; Node smoke test | 2026-09-13 |
| Comlink 4.4.2 `wrap`, `expose`, `proxy` | `comlink@4.4.2` type declarations | 2026-09-13 |
| Tally pre-defined groups | ADR-cited page in `packages/tally/src/groups.ts` (Tally.ERP 9 help); R-08 open | 2026-09-13 |

## Consequences

- Very large sheets still materialise as a grid in worker memory; memory-pressure messaging
  (SPEC §33) and a streaming reader are follow-ups if real files exceed what browsers allow.
- Fixture layouts are Tally-like, not verified TallyPrime exports (R-07); real exports may add
  quirks, each of which becomes a fixture variant.
