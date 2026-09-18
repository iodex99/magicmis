---
paths:
  - "packages/wallet/**"
  - "packages/billing/**"
  - "packages/core/src/money/**"
---

# Money, wallet and ledger rules

Gross margin is the single most important property of this product (SPEC §1). These
rules are not style preferences.

## Representation
- INR → **integer paise**. Credits → **integers**. AI cost → **integer micro-USD**,
  stored alongside its INR equivalent at the FX rate in effect (SPEC §4).
- **Never use JavaScript floating point for money.** No `number` arithmetic on amounts,
  no `parseFloat`, no `toFixed` to "fix" rounding. Use `bigint` or integer `number`
  with explicit unit-suffixed names (`amountPaise`, `costMicroUsd`, `credits`).
- DuckDB: `DECIMAL(38,4)` or integer paise.

## Invariants (SPEC §11)
- `balance_credits` = Σ `credits_remaining` over all lots. Credits never expire (ADR 0040).
- `held_credits` = Σ active reservations.
- `available` = balance − held.
- **Balance and held can never go negative.** Enforced by CHECK constraints *and* tests.
- `held_credits ≤ balance_credits`.

## Transactions
- Every wallet operation runs in **one** Postgres transaction that locks the account's
  `wallets` row with `SELECT ... FOR UPDATE`. No exceptions — this is what makes 50
  concurrent reservations against a balance-of-10 resolve to exactly 10 successes.
- Every operation writes `credit_ledger` rows carrying `balance_after`, `held_after`,
  and the `prev_hash`/`hash` chain.
- `credit_ledger` is **append-only**: the DB role has no UPDATE or DELETE grant on it.
- Capture consumes lots **FIFO, oldest first by `created_at`**, and releases any remainder.

## Idempotency
- Every mutating operation takes an idempotency key; `credit_ledger.idempotency_key` is
  UNIQUE. Applying the same key twice must produce exactly one effect.

## Pricing (SPEC §12)
- **Never hardcode a business number.** Prices, packs, tier multipliers,
  `max_ai_cost_ratio`, limits, retention periods, GST rate and FX rate come from
  `price_book` / `credit_packs` / `app_config`, versioned with `effective_from`.
- `ai_cost_cap_paise = price × 100 × max_ai_cost_ratio` (default ratio 0.20).
- Before every Anthropic call:
  `projected = cost_so_far + counted_input_cost + max_tokens × output_price`.
  Over cap → the job **pauses** in `needs_quote`, releases its reservation, records an
  `estimation_miss`. It must never silently overspend.
- Charges are computed **only** from Anthropic usage data the server receives directly —
  never from anything the browser reports (SPEC §7).

## Required tests (SPEC §11) — a change here is not done without them
- **Property:** replaying the ledger reproduces `wallets` state exactly.
- **Property:** no operation sequence drives balance or held negative.
- **Concurrency:** 50 parallel reservations, balance fits 10 → exactly 10 succeed, no
  overdraft. Use a real Postgres (Testcontainers/Supabase local), not a mock.
- **Idempotency:** same key twice → one effect.
- **Time travel:** reservation expiry and FIFO ordering. Lots do not expire (ADR 0040).
