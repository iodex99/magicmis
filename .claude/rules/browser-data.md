---
paths:
  - "packages/ingest/**"
  - "packages/tally/**"
  - "packages/redact/**"
  - "packages/engine/**"
  - "packages/render-excel/**"
  - "packages/render-dashboard/**"
---

# Browser-side data rules (Zone A)

The browser holds the raw data and is treated as an **untrusted client** (SPEC §7).

## What may leave the browser
Only these four things, and only after redaction:
1. redacted structural profiles
2. capped redacted samples
3. aggregates (ledger × period balances, metric store)
4. chat query results that pass the row cap and redaction

**Raw files never leave the browser.** They live in DuckDB memory and OPFS temp only,
cleared on logout, on "Clear session data", on new-session start, and on tab close where
possible. The **redaction token map never leaves the browser at all.**

Redaction (`packages/redact`) runs **before** any payload is sent. Not after, not
server-side.

## Redaction tokens must be stable across months (SPEC §17)

This is the requirement that quietly breaks everything downstream if got wrong: if a
party's token changes between periods, comparatives and continuity checks silently
compare two different entities.

- Token = truncated **HMAC-SHA-256** of the *normalised* value under a **per-company
  redaction key**, prefixed by type — `PARTY_9f3a1c2e`. Not a random ID, not a counter,
  not a plain hash. **Test the collision rate at the chosen truncation length.**
- The per-company redaction key is created at company creation, stored encrypted under
  the company DEK, and released only to the authenticated owner's browser.
- Server-side snapshots key party and employee rows **by token**. The browser rehydrates
  names by hashing names in the *currently loaded* files; a token with no match displays
  as the token plus a "name not in loaded files" hint.
- Company setting **"Store party and employee names encrypted"** (default **off**): when
  on, the browser uploads the token→name dictionary encrypted under the company DEK. The
  UI must explain the trade-off.
- Detectors: PAN · Aadhaar (Verhoeff) · UAN in UAN-labelled columns · IFSC
  `[A-Z]{4}0[A-Z0-9]{6}` · bank accounts (9–18 digits in account-labelled columns) ·
  GSTIN (**always** tokenise — it embeds a PAN) · email · Indian mobile · person-name
  columns in payroll/HR by header heuristic · any column the user marks sensitive ·
  **party ledgers** under Sundry Debtors/Creditors → `PARTY_*` (their group already
  determines the MIS head, so the name is never needed for mapping).
- The developer-mode payload inspector (SPEC §17) was **removed by the owner** (ADR 0031).
  What leaves the browser is enforced by `buildOutboundSheet` and
  `assertNoRawIdentifiers`, not by a viewer — keep every outbound payload on that builder.
- Tests: positive *and* negative cases per detector, including false positives such as
  invoice numbers and amounts.

## Parsing (SPEC §15)
- **Header-based parsing only. Never rely on column positions.** Score candidate header
  rows on text density, uniqueness, type contrast with rows below, and known header
  vocabulary. Support multi-row headers by concatenating levels. Where headings name no
  role, a column's **content** may decide it (ADR 0031: text column = ledger, one-sided
  amount pair = debit/credit) — and a sheet is a trial balance on content alone only if it
  nets to zero. PDF positions only rebuild the table; header detection still reads it.
- **Any file type** (ADR 0031): decide the format from the bytes (`readSourceFile`), never
  the extension; refuse only what cannot be read in the browser, always with a reason.
- All parsing runs in **Web Workers** (Comlink). The main thread never blocks.
- SheetJS reads **cached cell values — never evaluate formulas** — plus formatted text
  for type inference. `.xlsm` macros are never executed.
- Merged cells, hidden sheets and hidden rows are **flagged in the profile**, never
  silently dropped.
- Large CSVs stream into DuckDB by file registration — never materialised as JS objects.
- Zip-bomb guard: cap uncompressed size and entry count **before** parsing.

## Type inference — the two that bite
- **Dates are day-first. Always. Never month-first.** `1-Apr-25`, `01-04-2025`,
  `01/04/2025`, Excel serials.
- **Amounts:** Indian grouping (`1,00,000.00`) and international; parentheses mean
  negative; a trailing `Dr`/`Cr` sign convention is **recorded explicitly in the
  profile, never guessed silently**; Debit and Credit may be separate columns.

## Provenance
Every DuckDB row carries `_file_id`, `_sheet`, `_source_row` (1-based, as seen in
Excel). Original header text is kept in a header map.

## Tally (SPEC §16)
- Rebuild the group→ledger tree. **Subtotal rows are marked and never aggregated as
  data**; each subtotal is verified against the sum of its children (feeds check V4).
- Verify the predefined group lists against Tally documentation before seeding them.
- **Do not invent TallyPrime menu paths.** Write the structure and mark the exact path
  `TODO(review)`.

## Trust
Metrics computed in the browser are trusted only as *that account's own data*. They
affect that account's outputs and nothing else — never pricing, never billing, never
another tenant.

## Nothing is free (SPEC §2.3)
Before a paid action the UI may show **only** file name, size, sheet count, row count.
Sheet recognition, mapping results, data-quality findings and every output appear only
inside a paid action.
