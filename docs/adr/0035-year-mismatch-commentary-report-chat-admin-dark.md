# ADR 0035: The year the files run on, commentary as a report, a chat that answers back, and dark admin

**Status:** accepted · **Date:** 2026-09-18 · **Decided by** the product owner · **Extends** ADR
[0034](0034-one-currency-boardroom-reports-dark-mode.md) · **Amends** SPEC §23 (what a run reports)
and §9 (a company's reporting conventions were write-once)

## Context

Four things were left after ADR 0034, and the owner asked for all of them.

The first was found while taking screenshots: a demo company whose financial year started in
January, loaded with April–March exports, showed **negative revenue** on its dashboard. The engine
was right — Tally-style exports carry P&L ledgers as cumulative balances that reset at the source
system's year start, and the engine subtracts within the company's year — but nothing on the
screen said the two years disagreed, and there was no way to correct the company afterwards.

## Decision

### 1. A run says when the files run on a different year

`detectSourceFinancialYear` (`packages/engine/src/financial-year.ts`) reads the reset out of the
balances themselves: the month where the total of the P&L closings collapses and then climbs
again. It answers null where it cannot tell — fewer than four months, no reset, or a
movement-style export that never accumulates — because a false alarm here would be worse than
silence.

When the detected month differs from the company's, the run adds a notice: which month the files
run on, which month the company is set to, that the first month of each year will otherwise read
as a whole year, and where to fix it. It is a **notice, not a refusal** (ADR 0031): the workbook is
still delivered, because a customer who knows what is wrong can decide whether it matters.

### 2. Reporting conventions can be corrected

`PATCH /api/companies/:id` updates the four conventions (year start, currency, number format, date
order), and the company page offers them — under the setup screen before the first run, and beside
Delete company afterwards. The change reads no data and charges nothing, and applies to the next
run: **stored months are not recomputed**, because what was delivered is what was paid for.

### 3. Commentary reads as a report

Inside the conversation the commentary is one more thing the assistant said. **Open as a report**
puts it on its own page — a title block with the company and the month, numbered sections, a
readable measure, and a footer saying the figures were computed and checked and the wording drafted
from them. Printing from there prints the report alone, so the month's write-up can go into the
board pack beside the workbook.

### 4. The chat answers back while it is thinking

A question appears the moment it is asked rather than after the round trip, and the wait carries a
seconds counter — the one honest thing that is known about a wait that can run most of a minute.
Answers written as bullets are shown as bullets. Copy, follow-up questions drawn from the figures
an answer used, and tiers explained in words came with ADR 0034.

### 5. The admin console is dark too

The same cookie, the same inverted ramp, the same semantic surfaces, and a toggle in its rail. The
palette is copied into the console's stylesheet rather than shared at runtime: the two apps have
separate origins and separate CSS bundles by design (SPEC §6), and a shared token file that has to
be kept in sync is what `packages/ui/src/tokens.ts` already is.

## Consequences

- One more thing a run can tell a customer, and one fewer way for figures to be quietly wrong.
- Conventions are no longer write-once; a future migration that recomputes stored months on a
  conventions change would be a separate decision, deliberately not taken here.
- `detectSourceFinancialYear` is unit-tested against cumulative and non-cumulative series, and
  covered by the acceptance flow's April–March fixtures against an April company (no notice) —
  the case that must stay quiet.
