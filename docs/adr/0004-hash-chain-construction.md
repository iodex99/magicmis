# ADR 0004 — Hash chain: canonical JSON, advisory lock, monotonic sequence

**Status:** accepted · **Date:** 2026-09-11 · **Phase:** 0

## Context

SPEC §4 requires an append-only, hash-chained audit log (`prev_hash`, `hash`) covering
auth events, wallet mutations, pricing and config changes, admin actions, deletions and
consent records; the credit ledger is chained too. SPEC §30 runs a nightly verification
job that alerts on mismatch.

A chain is only worth having if a mismatch means tampering. If ordinary traffic can break
it, the nightly alert becomes noise and then gets ignored — which is worse than not having
the control, because it is mistaken for one.

## Decision

**1. Canonical serialisation before hashing.** Object keys sorted, no insignificant
whitespace, `bigint` as a decimal string, floats and `undefined` **rejected** rather than
coerced. Two writers serialising the same entry differently would break the chain for a
reason unrelated to tampering.

**2. `created_at` is not in the hashed payload.** The database assigns it after the hash
is computed; including it would require a round trip to learn the value being hashed, and
ordering is already guaranteed by the chain.

**3. Appends serialised with a transaction-scoped advisory lock**
(`pg_advisory_xact_lock`). Without it, two concurrent writers read the same tail hash and
produce two entries claiming the same predecessor. Transaction-scoped matters: the lock is
released by the same COMMIT that makes the row visible, so the next writer cannot read a
tail that has not landed.

**4. A `bigserial seq` column is the chain's order — never `created_at`.** This was found
by a failing test, not by design. `created_at` defaults to `now()`, which is
*transaction-start* time, so rows written in quick succession share it; the tie-break was
`id`, a **random** uuid. The tail lookup could therefore pick the wrong row and break the
chain under entirely ordinary traffic.

**5. Verification reports every bad row, not the first,** and continues from each row's
stored hash rather than the expected one. An operator needs to distinguish "one row was
edited" from "the chain was rebuilt from here" — those call for different responses.

## Verifying documentation

| Fact asserted | URL | Verified on |
|---|---|---|
| `now()` returns transaction start time, identical for every statement in a transaction | https://www.postgresql.org/docs/17/functions-datetime.html | 2026-09-11 |
| `pg_advisory_xact_lock` is held until transaction end and released automatically | https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS | 2026-09-11 |
| `gen_random_uuid()` returns a version 4 (random) UUID | https://www.postgresql.org/docs/17/functions-uuid.html | 2026-09-11 |

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| `JSON.stringify` as the canonical form | Key order follows insertion order, so the same logical entry hashes differently depending on how it was constructed. |
| Ordering by `(created_at, id)` | The defect above: `now()` ties, random uuid tie-break. |
| A UUIDv7 primary key instead of `bigserial` | Time-ordered and would mostly work, but ordering still depends on clock resolution rather than a guarantee. |
| Per-row `SELECT ... FOR UPDATE` on the tail | Works, but locks a row that a reader may legitimately want; an advisory lock expresses "serialise appends" directly. |
| No lock, tolerate breaks | Defeats the purpose. |

## Consequences

Easier: verification is a single ordered walk, paged so it scales with a log that only
grows. Tampering is detected even when the perpetrator disables the append-only trigger —
there is a test that does exactly that.

Harder: appends are serialised globally, so the audit log has a single-writer throughput
ceiling. At the volumes this product implies (auth events, wallet mutations, admin
actions) that is far from binding, but a future high-rate event source must not be routed
through this chain without revisiting it.

A related reader-side defect was caught by the same tests: `select seq::text as seq ...
order by seq` makes Postgres resolve `ORDER BY` to the **output** column — the text cast —
sorting `1,10,11,...,2,20` lexicographically and walking the chain out of order. It passed
with 8 rows, because 1–9 sort identically either way, and failed at 25. The cast is now
aliased `seq_text`.
