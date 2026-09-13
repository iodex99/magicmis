# ADR 0018 — Redaction tokens: 48-bit type-bound HMAC, redaction before every outbound payload

**Status:** accepted · **Date:** 2026-09-13 · **Phase:** 3

## Context

SPEC §17: PII detectors run in the browser before any payload leaves; tokens must be stable
across months, derived by truncated HMAC-SHA-256 under a per-company key, with the collision rate
tested at the chosen length; the token map never leaves the browser.

## Decisions

1. **`TYPE_` + 12 hex characters (48 bits)** of HMAC-SHA-256(key, `TYPE\0normalised value`).
   SPEC's example shows 8 hex characters (32 bits): ~1% chance of any collision among 10,000
   values in one company. 48 bits: ~2 × 10⁻⁷ at 10,000 and ~0.2% at 1,000,000 values. A test
   tokenises 100,000 distinct values without collision. Collisions are counted and surfaced.
2. **The type is bound into the MAC**, so a PAN and a party name that normalise alike never share a
   token.
3. **Per-type normalisation** (case, spacing, punctuation for names; digits only for numbers; last
   ten digits for mobiles) so cosmetic differences never split one entity.
4. **WebCrypto only** (`crypto.subtle`): identical in the browser and Node tests.
5. **Detectors**: value patterns (GSTIN before PAN, Aadhaar with Verhoeff and not starting 0/1 and
   not inside an amount, IFSC, email, mobile) and header-based columns (UAN, bank account, person
   names in payroll, user-marked sensitive). Labelled sensitive columns win over inferred types —
   digit-run identifiers type as integers. Integers are never passed through unredacted.
6. **Party names**: ledgers under Sundry Debtors/Creditors from any loaded trial balance or group
   summary, plus the party column of registers and bills reports, become `PARTY_*`.
7. **Outbound payloads** omit title lines, cap samples (15 rows) and distinct values (500, with
   truncation counts) from config, and pass a final guard that throws if any raw identifier
   pattern remains. The payload inspector renders that same object.
8. **The payload inspector is developer-mode only**: showing recognition results before a paid
   action would breach SPEC §2.3. In the preview it uses an ephemeral key; the company redaction
   key (generated at company creation, encrypted under the company DEK) arrives with companies.

## Consequences

- The company key's storage and delivery endpoint land with companies (Phase 5/6).
- Free-text narrations can contain names that no detector recognises; the "store names encrypted"
  setting and user-marked sensitive columns are the controls, and prompts treat all data as data.
