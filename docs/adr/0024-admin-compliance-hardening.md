# ADR 0024: Admin console completion, compliance surfaces and hardening

**Status:** accepted · **Date:** 2026-09-14 · **Phase:** 9

## Context

SPEC §26, §10, §18, §30, §31 and §34 Phase 9 require:

- **Admin:**
  - the full console, with the margin dashboard and daily email;
  - library curation;
  - the prompt activation gate;
  - break-glass access;
  - a price book impact preview.
- **Compliance:**
  - privacy and consent surfaces;
  - an asynchronous data export;
  - account and company deletion, with purge and crypto-shred;
  - a processing register.
- **Security (§30):**
  - a strict nonce-based CSP, with Razorpay only on the payment page, and HSTS;
  - rate limits and payload caps;
  - no secrets in client bundles (CI scan);
  - cross-tenant tests for every endpoint;
  - `<data>` wrapping of file-derived text;
  - Sentry scrubbing rules, tested;
  - a nightly audit chain verification with alerting;
  - runbooks;
  - a load test of wallet and job endpoints.
- **Acceptance:**
  - the margin dashboard flags a seeded over-ratio action;
  - purge verifiably destroys keys;
  - the security suite is green.

## Verified facts (2026-09-13/14)

| Fact | Source |
|---|---|
| Next.js 16 nonce CSP: generate the nonce in `proxy.ts`, set `Content-Security-Policy` on the request so Next applies the nonce to its scripts, and render dynamically. `'strict-dynamic'`; `'wasm-unsafe-eval'` for WebAssembly; `'unsafe-eval'` only in development. | `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md` (Next 16.3.5) |
| Next.js instrumentation: `instrumentation.ts` in `src/` exports `register()`, called once per server instance; runtime-specific code is imported inside it. | `node_modules/next/dist/docs/01-app/02-guides/instrumentation.md` |
| Sentry Next.js manual setup: `instrumentation.ts` `register()` initialises per `NEXT_RUNTIME`, and `onRequestError = Sentry.captureRequestError`. `@sentry/nextjs` and `@sentry/node` 10.74.0: `init(options)` with `beforeSend`, `sendDefaultPii`, `tracesSampleRate`, `maxBreadcrumbs`, `beforeSendTransaction`. | https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/ ; package typings |
| Razorpay Checkout CSP: allow `https://*.razorpay.com`. | https://razorpay.com/docs/payments/payment-gateway/cordova-integration/ |
| Razorpay webhooks: non-2xx is a failure; retried with exponential backoff for 24 h; then the webhook is disabled and the alert address emailed; re-enable in the Dashboard. | https://razorpay.com/docs/webhooks/faqs/ , https://razorpay.com/docs/webhooks/best-practices/ |
| AWS KMS `Encrypt`: `KeyId`, `Plaintext`, `EncryptionContext` → `CiphertextBlob`, `KeyId` (no `KeyMaterialId`, unlike `GenerateDataKey`). | `@aws-sdk/client-kms` 3.1131.0 typings; https://docs.aws.amazon.com/kms/latest/APIReference/API_Encrypt.html |
| Supabase Auth admin `deleteUser(id, shouldSoftDelete?)`. | `@supabase/auth-js` 2.116.0 `GoTrueAdminApi.d.ts` |
| Docker Desktop on Windows: Node resolves `localhost` to `::1` first, and the IPv6 port forwarder drops some connections in bursts; they hang until `ECONNRESET` at about 30 s. `127.0.0.1` does not. | Reproduced locally (debugging notes in commit `bc4af44`) |

## Decisions

### 1. Margin dashboard, admin console, break-glass

- **Margin report (`@magicmis/ai/margin`):**
  - per action: jobs and priced chat messages, AI cost ratio overall and at p50/p90, flagged over `max_ai_cost_ratio`;
  - estimator drift, quote and failure rates, breakage and memory fees;
  - a daily gross margin estimate. Payment fee % and infra cost come from config (R-47).
- **Daily email:**
  - sent once per admin per IST day (idempotency key);
  - carries the audit chain head (seq and hash), so a copy of the head lives outside the database (R-52).
- **Price book preview:** reprices the last 30 days of captured usage under proposed values. Each item keeps its tier and delivery, and its credits change by exactly the proposed minus current book price, so add-ons priced elsewhere carry over. Quoted jobs keep their quote.
- **Break-glass:**
  - a grant for one account, with a written reason of 20–500 characters (the customer template's limit, also a database check);
  - at most `admin.break_glass_max_minutes`;
  - refused for purged accounts;
  - each grant, view and revoke is audit-logged;
  - the account holder is emailed at grant time, including accounts closed but not yet purged.
  - A known notice type whose payload its template rejects is marked **failed**, never suppressed.

### 2. Erasure is crypto-shred plus scrubbing, after a delay

- **`deleteAccount`:**
  - refuses while credits are held, checked under the wallet row lock;
  - closes the account and schedules every company's purge;
  - audit-logs and emails.
- **Web delete route:** requires re-authentication and the typed email, removes the Supabase Auth user, and signs out.
- **`purgeAccounts`:** purges the account's companies (destroy company keys, remove outputs, rename to "Deleted company"), removes exports and library votes, and destroys the account key (`wrapped_dek` null, `destroyed_at` set, never regenerated). It then scrubs:
  - email, business name, billing address and GSTIN;
  - login events;
  - consent IPs;
  - notification payloads.

  Invoices and the ledger remain for the statutory period.
- **Keys:** a wrapper is required, so votes cannot be left behind. Failures are isolated per company and per account and reported together.
- **Company delete:** requires re-authentication, UUID validation and idempotency. It is refused while a job or chat message holds credits for the company, and is audit-logged.

### 3. Data export is asynchronous, sealed and re-authenticated

- **Request:** `requestAccountExport` queues one export at a time.
- **Build:** the worker task (`privacy-exports`, every 2 min) builds JSON containing:
  - profile;
  - companies, with decrypted blueprint and snapshots;
  - jobs, ledger, lots and invoices;
  - consents;
  - sign-in history.
- **Storage and delivery:** the file is sealed under the **account** DEK, stored privately, and emailed as a link to `/settings/privacy`. It expires after `privacy.export_link_hours`, and the file is removed on expiry and at purge.
- **Re-authentication:** needed to request **and** to download (SPEC §8).

### 4. Consent is recorded and enforced on the server

- **Signup:** records terms and privacy.
- **First upload:** the notice records `processing` at the current `legal.document_versions`.
- **Enforcement:** job creation and chat messages refuse with `consent_required` until the current processing version is accepted, so a scripted client cannot skip the notice.
- **Legal pages:** structured outlines of how the product behaves, marked `TODO(review)` (R-10, R-11). The processing register is in `docs/compliance`.

### 5. Global library candidates from digest-only votes

- **Votes:** when an account saves rules, each eligible normalised name records `(HMAC(name), head, HMAC(account id), name sealed)` under a KMS-wrapped platform key.
- **Eligibility is an allowlist:** every word must be in the accounting and connecting vocabulary or in the seeded library, with at least one accounting word. Redaction tokens, long digit runs, honorifics and entity suffixes are excluded. "Loan from Ramesh Patel" is therefore never counted.
- **Candidates:** a nightly pass turns pairs with at least `semantic.library_promotion_min_accounts` distinct accounts into pending candidates, and refreshes pending counts (a purged account stops counting). Promotion stays admin-only.

### 6. Web hardening

- **CSP and headers:**
  - A per-request nonce CSP from `@magicmis/core/security-headers`, applied by both apps' proxies. `strict-dynamic` and `wasm-unsafe-eval`; no `unsafe-inline` for scripts; styles allow inline because React server-renders `style` attributes.
  - `frame-ancestors 'none'`, `object-src 'none'`, nosniff, `X-Frame-Options`, a permissions policy and COOP.
  - HSTS and `upgrade-insecure-requests` only over HTTPS.
  - Razorpay hosts only on `/wallet`.
  - Every page renders dynamically (`connection()` in the root layout).
  - E2E fails on any CSP console violation.
- **Rate limits:**
  - fixed-window counters in Postgres (`rate_limit_counters`), shared across instances, pruned by a scheduled task;
  - per account on AI stages, commentary, Deep step results, chat messages and exports;
  - per IP on the authenticated API.
- **Client IP:** only proxy-added values count: `x-vercel-forwarded-for`, else the right-most `x-forwarded-for`. `x-real-ip` is never read. The admin allowlist fails closed.
- **Body caps:** JSON bodies are read as a stream and abandoned past `api.max_json_body_bytes`. Job completion uses its own limit derived from the snapshot and workbook caps, and checks ownership before reading.
- **Idempotency:** every scope includes the account id, so a key reused by another account can never replay a response.
- **Cross-tenant E2E:** probes every id-scoped route (and ids passed in bodies) with bodies that pass validation, and expects 403 or 404. A guard fails when a new `[id]` route has no probe.

### 7. Prompt-injection boundary

- **`dataBlock`** wraps every user-derived block (stable and volatile), including chat history, Deep tool results and repair feedback. It neutralises data-tag look-alikes after NFKC and removal of format characters, including entity-encoded forms.
- **Refs** are restricted to `[A-Za-z0-9_-]`, and attribute values are JSON-quoted.

### 8. Keys: master-key replacement

- **Rotation:** KMS automatic rotation needs no action.
- **Replacing the key:**
  - `RotatingKeyWrapper` (current plus previous) lets every app open DEKs under either key during the move.
  - `rewrapDataKeys` moves company, account and platform DEKs and admin TOTP keys to the new key, keyed on one version string per master key. It is resumable, skips shredded keys, and records rows already under the new key instead of aborting.
  - The KMS wrapper now stores the key ARN for both `GenerateDataKey` and `Encrypt`.
  - CLI: `pnpm --filter @magicmis/worker rewrap-keys`.
  - Runbook: `docs/runbooks/key-rotation.md`.

### 9. Integrity, observability, CI, load

- **Nightly `integrity-verify`:** walks the audit chain and replays every ledger (every account with a ledger or a wallet) against its wallet row. On mismatch it writes `integrity.check_failed` and emails admins ids and sequence numbers only. It detects edits and broken links; it does not detect a full rewrite by someone with database owner access (R-52).
- **Sentry:**
  - server-side only, in web, admin and worker, initialised only with `SENTRY_DSN`;
  - every event passes an allowlist scrubber (type, masked message, frame locations, runtime; no request, user, extra, breadcrumbs, source lines or variables);
  - no tracing;
  - no browser SDK and no replay, because the browser shows financial data;
  - no source-map upload, so `@sentry/cli`'s postinstall is declined.
- **CI:** scans built client bundles for server env values (placeholders are 32+ characters), secret-shaped tokens and markers of server-only code.
- **Load tests:**
  - `pnpm --filter @magicmis/wallet load` drives concurrent reserve/capture/release cycles and asserts replay, chain, non-negativity and conservation;
  - `scripts/load-http.mjs` measures signed-in endpoints.
- **Test harness:** connects over IPv4. This fixed the intermittent 30 s concurrency test timeouts; product code was not the cause.

## Consequences

- **Acceptance evidence:**
  - **Margin flag:** `packages/ai/test/services.test.ts` and `apps/admin/e2e/admin.spec.ts`.
  - **Purge destroys keys:** `packages/jobs/test/lifecycle.test.ts` (account erasure: every key null and destroyed, sealed data unreadable, the key never regenerated, personal fields scrubbed, audit entries).
  - **Security suite:**
    - `apps/web/e2e/privacy.spec.ts`: cross-tenant probes, oversize and malformed payloads, re-authentication on export and delete;
    - `apps/web/e2e/ingest.spec.ts` and `mis.spec.ts`: CSP headers and zero violations across the full flows;
    - `packages/core` security-header and error-scrub tests;
    - `packages/ai/test/injection.test.ts`;
    - `packages/db/test/ratelimit.test.ts`;
    - the CI bundle scan.
- **Open for review:**
  - R-47–R-50 (margin inputs, rate limits, export lifetime, processing register);
  - R-51 (payment reconciliation job);
  - R-52 (tamper-evident chain anchoring);
  - R-53 (break-glass per-company scope and admin re-authentication);
  - R-54 (scanning rendered HTML/RSC for secrets);
  - R-55 (hosting assumptions behind the CSP and client IP).
- **Spec deviations:** none. The CSP allows inline *styles* (not scripts); this is recorded here because §30 says "strict". A nonce cannot cover React's server-rendered `style` attributes.
