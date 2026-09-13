# ADR 0014 — Credit wallet: row-locked operations, per-account ledger chain, expiry-first

**Status:** accepted · **Date:** 2026-09-13 · **Phase:** 2

## Context

SPEC §11 defines lots, reservations, capture, release, expiry, admin adjustment, and the tests
that must hold: ledger replay reproduces `wallets`; balance and held never negative; 50 parallel
reservations against a balance fitting 10 give exactly 10; idempotency; time travel.

## Decisions

1. **Every operation is one transaction locking `wallets` `FOR UPDATE`.** That lock serialises
   everything for an account, including the ledger tail read, so a per-account chain is safe
   without an advisory lock. `grantCreditsInTx` exposes the same logic inside a caller's
   transaction for purchase crediting (ADR 0013).
2. **Expire due lots first, in every operation.** So `balance = Σ unexpired lots` holds at every
   operation, not only after the nightly sweep. The nightly job is a sweep for idle accounts.
3. **Per-account hash chain with `seq bigserial`.** Order is `seq`, never `created_at` — the
   Phase 0 audit-log defect (ADR 0004) would recur otherwise. The text cast is aliased
   `seq_text`; aliasing it `seq` made `order by seq` sort text ("107" before "93"), a defect the
   wallet tests caught a second time.
4. **Ledger effect is defined once** (`applyEntry`) and replay is tested against it.
5. **Expiry that uncovers holds shrinks the newest holds first** and writes a `release` row
   *before* the `expire` row, keeping the database CHECK `held_after ≤ balance_after` true row by
   row. A later capture of a shrunk reservation is limited to what remains (SPEC §11.5).
6. **Capture consumes lots FIFO by earliest `expires_at`** and releases any remainder.
7. **Idempotency by ledger key.** Each operation derives deterministic keys
   (`reserve:{id}`, `expire:lot:{id}`, `purchase:{id}:credits`, …); `credit_ledger.idempotency_key`
   is unique, so a repeat is detected under the wallet lock and changes nothing.
8. **Pricing in exact decimal.** Multipliers are decimal strings; `round(base × multiplier +
   surcharge)` in bigint with the configured mode; the AI cost cap floors; over-cap quotes round up
   to configured endings. `cancel_after_ai_fee` prices from `data_diagnostic` via
   `price_from_action_key`. Expert+ is refused by `priceFor`. A public price list exposes credits
   only — never ratios or caps.

## Evidence

`packages/wallet/test`: 50-way concurrency, parallel capture/release, fast-check property over
random operation sequences (replay equals wallet, never negative), time travel for lot expiry,
reservation sweeper, shrink-then-capture, notices, admin adjust; pricing formula vectors,
properties for cap and quote, price book versioning and disabled actions.

## Consequences

- A long-running transaction on one account blocks that account's wallet operations only.
- Price changes are always new versions (admin console enforces no retroactive effective dates).
