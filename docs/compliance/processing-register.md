# Processing register

SPEC §31 requires this register as part of readiness for India's Digital Personal Data Protection
Act, 2023. The Act's core obligations apply from May 2027.

It records what personal data the product processes, why, where, for how long, and who else
touches it. It describes the system as built. It is not legal advice.

> TODO(review): R-50 — a data protection professional must review this register before launch. They should confirm:
> - the purposes, the legal basis wording and the retention periods;
> - the subprocessor list;
> - the grievance officer details;
> - whether any processing makes us a Significant Data Fiduciary.

Owner: product owner. Update this register whenever a table, a subprocessor or a retention setting changes.

---

## 1. Data principals

**Account holders** are one login per account (SPEC §2.2). They are typically:
- chartered accountants;
- finance staff of Indian SMEs.

**Third parties in client data** appear in the files an account holder loads:
- parties (debtors and creditors);
- employees in payroll exports.

Their raw details stay in the browser (SPEC §2.8). Where they reach the server, they arrive only as HMAC tokens (SPEC §17).

## 2. Processing activities

| # | Activity | Personal data | Purpose | Basis (draft) | Where | Retention | Code |
|---|---|---|---|---|---|---|---|
| P1 | Account and sign-in | Email, password (held by Supabase Auth), TOTP secret (encrypted), backup code hashes | Provide the account; one-session rule; security | Contract | Supabase Postgres + Auth, Mumbai | Life of account; scrubbed at purge | `packages/accounts` |
| P2 | Login history | IP address, approximate location, user agent, device fingerprint hash | Security alerts, account protection | Legitimate use (security) | Postgres | Life of account; deleted at purge | `login_events` |
| P3 | Business profile and billing | Business name, GSTIN, billing address, state code | Tax invoices under GST | Legal obligation | Postgres | Statutory period (config, default 8 years) | `accounts`, `invoices` |
| P4 | Payments | Razorpay order/payment IDs (no card data) | Buying credits | Contract | Postgres; Razorpay | Statutory period | `packages/billing` |
| P5 | File analysis in the browser | Everything in the loaded files, including third-party names, PAN, Aadhaar, bank details | Build the MIS the user asked for | Contract (the account holder is responsible for their clients' data) | Browser memory / OPFS only | Cleared on sign-out, Clear session data, new session, tab close | `apps/web/src/lib/ingest`, `packages/redact` |
| P6 | AI actions | Redacted structural profiles, capped redacted samples, aggregates, chat messages | Sheet recognition, mapping, commentary, chat | Contract | Server → Anthropic (subprocessor) | Stage outputs and raw AI responses encrypted, 30 days (config) | `packages/ai` |
| P7 | Company memory | Blueprints and snapshots, keyed by tokens; encrypted names only if the company opts in | Comparatives, refresh without re-mapping, chat | Contract | Postgres, AES-256-GCM under a per-company key | Until the company or account is deleted, then crypto-shred after `lifecycle.deletion_purge_delay_days` | `packages/engine` |
| P8 | Generated workbooks | Figures and labels from the user's data | Re-download | Contract | Supabase Storage, encrypted | `outputs.retention_days` | `packages/jobs` |
| P9 | Notifications | Email address, event metadata (no financial content) | Security, billing and lifecycle notices | Contract / legal obligation | Postgres → Resend (subprocessor) | Life of account | `apps/worker` |
| P10 | Consent records | Document, version, time, IP | Show consent was given | Legal obligation | Postgres, audit-logged | Life of account | `consents` |
| P11 | Audit log | Actor IDs, action, IP; no financial data content | Security and accountability | Legal obligation / legitimate use | Postgres, hash-chained, append-only | Retained (append-only) | `packages/db/src/audit.ts` |
| P12 | Support break-glass access | Decrypted company memory, viewed by an admin under a time-limited grant | Support the user asked for | Contract; the account holder is notified | Admin console | Grant expires within `admin.break_glass_max_minutes`; every view audited | `apps/admin` |
| P13 | Data export | Everything in P1–P4, P7, P10 | Right to access | Legal obligation | Worker → Storage, sealed under the account key | Link valid `privacy.export_link_hours`, then file removed | `packages/jobs/src/exports.ts` |

## 3. Subprocessors

| Subprocessor | Data | Region | Notes |
|---|---|---|---|
| Supabase | P1–P4, P7–P11, P13 | ap-south-1 (Mumbai) | ADR 0003 |
| Anthropic | P6 payloads only | TODO(review): R-50 | Server-side key; action-specific endpoints only (SPEC §2.9) |
| AWS KMS | Wraps data keys; sees no personal data | ap-south-1 | ADR 0008 |
| Resend | Email address, notice text | TODO(review): R-50 | ADR 0010 |
| Razorpay | Payment details entered on Razorpay Checkout | India | ADR 0012 |
| Vercel | Request metadata in transit | Functions pinned nearest India | SPEC §5 |

## 4. Data principal rights

| Right | How it is met | Code |
|---|---|---|
| Access and export | Settings → Privacy and data → Request export. The export is built asynchronously, emailed as a link, and downloadable only while signed in. | `/api/account/export`, `processAccountExports` |
| Correction | Settings → Business profile (email change with verification). | `/api/account/profile` |
| Erasure: company | Company page → Delete company. The fee stops at once; crypto-shred after the delay. | `DELETE /api/companies/:id`, `purgeCompanies` |
| Erasure: account | Settings → Privacy and data → Delete account. Requires re-authentication and typing the account email. Details below the table. | `/api/account/delete`, `deleteAccount`, `purgeAccounts` |
| Consent | Signup records terms and privacy consent. The first upload records processing consent at the current `legal.document_versions`. | `/api/account/consents`, `ProcessingNotice` |
| Grievance | TODO(review): R-11, R-50 | — |

When an account is erased:
- The Auth user is removed immediately.
- Companies and the account key are shredded after the delay.
- Email and business name are scrubbed.
- Login history is deleted.
- Invoices and ledger are retained.

## 5. Security measures

- **Encryption:**
  - Envelope encryption (AES-256-GCM) with a KMS master key.
  - Per-company and per-account data keys.
  - Erasure destroys the key, not just the rows.
- **Tenancy:** Row-level security on every customer table, and a cross-tenant test harness.
- **Authentication:**
  - Mandatory TOTP.
  - One active session.
  - Re-authentication for sensitive actions.
- **Audit:** Hash-chained audit log and ledger, verified nightly.
- **Redaction:** Runs in the browser before any payload is sent. The token map never leaves the browser.
- **Rate limits and payload caps:** On AI, chat and export endpoints (SPEC §30).

## 6. Breaches

See [docs/runbooks/breach-response.md](../runbooks/breach-response.md).
