# ADR 0002 — Money as branded `bigint`, not a decimal library

**Status:** accepted · **Date:** 2026-09-11 · **Phase:** 0

## Context

SPEC §4 requires INR as integer paise, credits as integers, AI cost as integer micro-USD,
and states plainly: "Never use JavaScript floating point for money." SPEC §1 makes gross
margin the single most important property of the product, and SPEC §11 requires a ledger
that replays to exactly the stored wallet state.

A convention alone does not achieve this. `const total = price * 1.18` compiles fine
under any amount of discipline.

## Decision

Money is `bigint`, wrapped in branded types: `Paise`, `MicroUsd`, `Credits`.

`bigint` is the load-bearing half. `1n * 1.5` is a **TypeError at runtime**, and mixing
`bigint` with `number` is a compile error — so "never use floating point for money" stops
being a rule reviewers have to enforce and becomes something the language refuses.

The brands are the other half. Paise, micro-USD and credits are all integers at runtime
and mutually indistinguishable; only the type system can stop a micro-USD value being
passed where paise is expected.

Decimal ratios (tier multipliers, `max_ai_cost_ratio`, GST rate, FX buffer) arrive from
config as strings and are parsed into an exact scaled integer (`unscaled / 10^scale`).
Multiplication happens before division so no intermediate precision is lost. Rounding has
**no default mode** — every caller names one.

## Verifying documentation

| Fact asserted | URL | Verified on |
|---|---|---|
| `bigint` and `number` cannot be mixed in arithmetic; doing so throws `TypeError` | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt | 2026-09-11 |
| Postgres `bigint` is a 64-bit signed integer, exceeding JS `Number.MAX_SAFE_INTEGER` | https://www.postgresql.org/docs/17/datatype-numeric.html | 2026-09-11 |

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| `decimal.js` / `big.js` | Solves precision but not discipline: nothing stops someone constructing one from a float, and nothing distinguishes paise from micro-USD. Also adds a dependency on every package that touches money. |
| `number` with integer paise | Sufficient range (paise stay inside `MAX_SAFE_INTEGER` until roughly ₹90,000 crore), but leaves every float bug one typo away. The range was never the reason to choose `bigint`. |
| Postgres `numeric` end to end | Right in the database, but values still have to cross into JavaScript, which is where the precision is lost. |

## Consequences

Easier: an entire category of bug is unrepresentable. Property tests confirm sums are
order-independent and that format→parse round-trips exactly.

Harder: `bigint` does not serialise to JSON, so every boundary converts explicitly — which
is appropriate, since the database wants a string or a numeric anyway. Branded values also
trip `@typescript-eslint/no-unsafe-unary-minus` on `-someValue`; `unbrand()` exists for
that, deliberately narrow rather than disabling the rule.

Parsers **reject** rather than round: a third decimal place in a rupee amount means the
data is not in rupees, and silently dropping it would lose money invisibly.
