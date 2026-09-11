# ADR 0000 — ADR template

**Status:** accepted · **Date:** 2026-09-11 · **Phase:** 0

> Copy this file to `docs/adr/NNNN-kebab-case-title.md`. Numbers are sequential and
> never reused. One decision per ADR. Keep an accepted ADR immutable — supersede it with
> a new one rather than editing it, and note the supersession in both.

---

## Context

What forced a decision. The constraint, the requirement, the thing that broke. Cite the
spec section driving it (e.g. SPEC §11 requires the ledger to replay exactly).

## Decision

What was decided, in the active voice. One paragraph.

## Verifying documentation

**Required for every external fact** — SPEC §0.4 forbids guessing an API shape, and an
ADR asserting one without a source is incomplete.

| Fact asserted | URL | Verified on |
|---|---|---|
| e.g. Batch results are polled, not pushed | https://docs.claude.com/... | 2026-09-11 |

For model IDs, prices, cache multipliers or the batch discount, also update
`model_registry.source_url` and `verified_at`.

If the documentation does not answer the question, say so here. Do not fill the gap with
a plausible guess.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
|  |  |

A rejected alternative with no reason is not a considered alternative.

## Consequences

What this makes easy, and — more usefully — **what it makes harder later.** Note
anything in SPEC §3's "build for extension" list that this constrains: connectors
implementing the ingestion interface, templates and dashboard specs staying data, the
chat engine later querying stored data.

## Deviation from a spec default

Only if applicable. SPEC §5 allows changing a stack default **only** where documentation
shows it cannot meet a requirement. Quote the documentation that shows it.
