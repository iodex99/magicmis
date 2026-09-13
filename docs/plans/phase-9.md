# Phase 9: Admin console completion, compliance surfaces, hardening

Scope from SPEC §34:

> - Full admin console (Section 26) including margin dashboard and daily email; library curation; prompt activation gate; break-glass flow.
> - Privacy and consent surfaces, data export, account and company deletion with purge and crypto-shred.
> - CSP and security headers, rate limits, runbooks, load test of wallet and job endpoints.
> - *Acceptance:* margin dashboard flags a seeded over-ratio action; purge verifiably destroys keys; security suite green.

## Plan

1. **Margin.** `marginReport` with filters, chat actions, p50/p90, estimator drift, quote and failure rates, breakage, memory fees and gross margin; the admin page; the daily admin email.
2. **Admin console.**
   - models and routing;
   - config editor;
   - jobs inspector with state timeline;
   - library curation;
   - prompt activation;
   - break-glass with audited views and customer notice;
   - price book impact preview.
3. **Compliance.**
   - account erasure with delayed purge and account-key shred;
   - asynchronous sealed data export;
   - processing consent and first-upload notice;
   - privacy and data settings;
   - company delete UI;
   - legal page outlines;
   - processing register;
   - library candidates from digest-only votes.
4. **Hardening.**
   - nonce CSP and security headers;
   - database-backed rate limits;
   - client bundle secret scan in CI;
   - nightly audit and ledger integrity check;
   - master-key re-wrap;
   - prompt-injection boundary;
   - server-side Sentry with a tested scrubber;
   - runbooks;
   - wallet and HTTP load tests;
   - cross-tenant and payload E2E.
5. **Security audit** of the phase, fix the findings, then docs: ADR 0024, this summary, review items.

**Migrations:**
- **0025:** break-glass grants, rate-limit counters, account purge columns, admin and rate-limit config.
- **0026:** data exports; removes the duplicate `legal.versions`.
- **0027:** platform keys, library votes.
- **0028:** JSON body limit.
- **0029:** break-glass reason cap, rate-limit window index.

## Summary (2026-09-14)

**Acceptance (SPEC §34): met.** 814 unit and integration tests across 23 packages, web E2E (26) and admin E2E (3) green; lint, typecheck and formatting clean.

| Criterion | Evidence |
|---|---|
| Margin dashboard flags a seeded over-ratio action | `packages/ai/test/services.test.ts`: commentary at 0.30 against 0.20 is flagged, with p50/p90, filters, chat actions and gross margin. `apps/admin/e2e/admin.spec.ts`: a seeded over-ratio job shows under `margin-flags` in the browser. `apps/worker/test/worker.test.ts`: the daily email names the action. |
| Purge verifiably destroys keys | `packages/jobs/test/lifecycle.test.ts`, account erasure. After the delay, every company key and the account key have `wrapped_dek` null and `destroyed_at` set. The ciphertext remains but `latestSnapshot` throws "destroyed", and saving rules refuses to regenerate the account key. Email, business name, GSTIN, company name, consent IPs, notification payloads and login events are scrubbed. The ledger is unchanged, and `account.deletion_requested` and `account.purged` are audited. The company purge test and `packages/jobs/test/exports.test.ts` (export files removed at purge) cover the rest. |
| Security suite green | See "Security suite" below. |

**Security suite:**
- **`apps/web/e2e/privacy.spec.ts`:**
  - every id-scoped route, and ids passed in bodies, probed from another account with valid bodies, expecting 403 or 404; a guard fails if a new `[id]` route has no probe;
  - oversize (6 MB) and malformed bodies refused;
  - export refused without re-authentication, then requested, built, downloaded and read;
  - account deletion behind re-authentication and the typed email; the login no longer works.
- **`apps/web/e2e/ingest.spec.ts` and `mis.spec.ts`:** per-request nonce CSP, Razorpay only on `/wallet`, hardening headers, and zero CSP violations across ingestion, setup, refresh, dashboard, commentary and chat (DuckDB-WASM and libpg-query included).
- **`packages/ai/test/injection.test.ts` and `orchestrator.test.ts`:** data-tag boundary against 13 fixtures (closing tags, case, spacing, zero-width, fullwidth, entities) and through a real stage request.
- **`packages/core`:** security headers, client IP (spoofed `x-forwarded-for` and `x-real-ip` ignored), and error scrubbing (customer data in every Sentry event field removed).
- **Database and worker tests:**
  - `packages/db/test/ratelimit.test.ts`;
  - `packages/jobs/test/rewrap.test.ts` (master-key replacement, including DEKs created mid-rotation);
  - `apps/worker/test/worker.test.ts` (integrity alert on a tampered wallet; template-rejected notices fail rather than suppress; closed accounts still get break-glass notices);
  - `apps/admin/test/console.test.ts` (break-glass reason cap and purged-account refusal).
- **CI:** client bundle scan (clean on both apps; a planted key and SDK marker are caught), dependency audit, gitleaks.

**Also delivered:**
- **Library candidates:** digest-only votes (`packages/jobs/test/library.test.ts`); an allowlist vocabulary rejects person and party names (`packages/semantic/test/library-eligibility.test.ts`).
- **Price book preview:** `packages/ai/test/price-impact.test.ts` and the admin E2E.
- **Data export:** sealed under the account key, expiring link, cross-account refusal (`exports.test.ts`).
- **Company and account delete:** refused while credits are held; audit-logged.
- **Runbooks:** key rotation, breach response, break-glass, model unavailability, payment webhook outage (with account recovery and admin access from earlier phases).
- **Load test:** `pnpm --filter @magicmis/wallet load` with 10 accounts × 30 cycles at concurrency 16 finished in 6.3 s (47 cycles/s). Reserve p50 138 ms / p95 330 ms; capture p50 208 ms / p95 357 ms (local Docker). There were no violations of replay, hash chain, non-negativity or conservation.
- **Test infrastructure:** Testcontainers over IPv4 ends the intermittent 30 s concurrency timeouts, which came from Docker Desktop IPv6 forwarding.

### Security audit (2026-09-14)

A security audit of the phase found 3 high, 7 medium and 9 low issues. All high and medium findings are fixed in this phase:

| # | Finding | Fix |
|---|---|---|
| H1 | Data export needed no re-authentication | Re-auth on request and download; UI and E2E updated |
| H2 | Break-glass customer email could be dropped (reason length, closed accounts) | Reason capped at 500 in console, DB and template; closed accounts still notified; template rejection marks the notice failed |
| H3 | Company delete lacked re-auth, audit, idempotency and a hold check | All added; `CompanyBusy` refusal |
| — | Found by the tightened probes: restore and heartbeat answered 409/200 for another account's ids | Both now 404, like a missing id |
| M1 | Re-wrap could not finish on real KMS (version strings differ) | One version per master key; rows already under the new key are recorded, not fatal; tested |
| M2 | Account purge left personal data | GSTIN, company names, consent IPs and notification payloads scrubbed; wrapper required |
| M3 | Library eligibility admitted person names next to accounting words | Every word must be in the vocabulary allowlist |
| M4 | Processing consent enforced only in the browser | Job creation and chat messages refuse without it |
| M5 | Integrity check missed ledgers without wallets and whole-chain rewrites | Ledgers without wallets are checked; chain head emailed daily; keyed or anchored chain → R-52 |
| M6 | Job completion buffered unbounded bodies | Ownership first, then a streamed read with a limit |
| M7 | Cross-tenant probes incomplete and vacuous | Valid bodies, all routes, coverage guard |

The low findings:
- **Fixed:**
  - L1: trusted client IP, off-request pruning;
  - L2: look-alike tags, ref charset, repair feedback;
  - L3: held check under the wallet lock;
  - L4: CI placeholder length;
  - L5: rate limits on commentary and Deep steps;
  - L7: per-item purge isolation;
  - L9: idempotent consent.
- **Recorded as review items:** L6 → R-53; L8 → R-55; the rendered HTML/RSC part of L4 → R-54.

### Dependencies added

| Dependency | Why |
|---|---|
| `@sentry/nextjs` 10.74.0 (web, admin), `@sentry/node` 10.74.0 (worker) | SPEC §5 names Sentry. Server-side error reporting only, behind the scrubber. `@sentry/cli` postinstall declined (no source-map upload). |
| `tsx` 4.23.13 (wallet, dev) | Runs the wallet load script; already used elsewhere in the repo. |

### Review items raised

R-47 through R-55 (see [REVIEW_ITEMS.md](../REVIEW_ITEMS.md)).

R-24 is closed. R-10, R-11 and R-12 are drafted. R-31 is built pending CA review of the vocabulary.

### Not done in this phase

- **Browser error reporting:** deliberately absent (ADR 0024 §9).
- **Admin MFA reset action (R-21):** still the witnessed SQL insert from the runbook.
- **Tamper-evident chain anchoring (R-52)** and the **payment reconciliation job (R-51):** recorded.
