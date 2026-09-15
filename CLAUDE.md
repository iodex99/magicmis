# Project brain — [PRODUCT_NAME]

Prepaid, usage-priced AI MIS platform for Indian CA firms and SMEs.
Full specification: [docs/SPEC.md](docs/SPEC.md) — complete, Sections 0–35.

---

## Current phase

**All ten phases built (§34)**, plus the Phase 9 follow-ups (ADR [0025](docs/adr/0025-reconciliation-anchors-break-glass-scope.md)), the interface redesign (ADR [0026](docs/adr/0026-ui-redesign.md), plan [ui-redesign](docs/plans/ui-redesign.md)) and the friction pass (ADR [0027](docs/adr/0027-friction.md), plan [friction](docs/plans/friction.md)). What remains needs owner input: [docs/REVIEW_ITEMS.md](docs/REVIEW_ITEMS.md) (live evals R-28, legal text, seller details, final prices).

Design system: tokens in `packages/ui/src/tokens.ts`, mirrored into both apps' `globals.css`.
Primitives in `apps/web/src/components/ui.tsx`; icons are hand-drawn in `Icon.tsx` (no icon
dependency, and never a sparkle). One indigo accent; the dark `ink` surface is navigation
only and never sits under figures. Seed a signed-in demo account against the local stack
with `apps/web/e2e/support/seed-demo.ts`.

Flow rules that are easy to undo by accident: sign-up asks for four things only (billing
details are collected at the first purchase, migration 0034); the confirmation email lands
on `/sign-in/enrol` with a session already established; the run screen prices itself and
its single button **is** the SPEC §12 confirmation. Changing `supabase/templates/` needs
`docker restart supabase_auth_magicmis` to take effect locally.

CI runs E2E against a **clean** Supabase stack, which catches what a long-lived local one
hides. Before pushing a flow change, reproduce it: `npx supabase stop --no-backup` then
`npx supabase start -x storage-api,imgproxy,realtime`.

Local stack: `npx supabase start -x storage-api,imgproxy,realtime` (storage is unused until
Phase 6 and its container fails a health check on first boot here). Apply new migrations with `npx supabase migration up`.
Web E2E: `pnpm --filter @magicmis/web build && pnpm --filter @magicmis/web e2e`.
Admin E2E (needs `apps/admin/.env.local`, see `.env.example`; `APP_ENVIRONMENT=development`):
`pnpm --filter @magicmis/admin build && pnpm --filter @magicmis/admin e2e`. Stop any stray
server on ports 3000/3001 first — Playwright reuses an existing server.
Fixtures: `pnpm --filter @magicmis/fixtures generate` (and `generate:large`) write `fixtures/out`;
web E2E global setup generates them if missing and clears the local sign-up throttle (10/hour per IP).
Worker locally: `pnpm --filter @magicmis/worker start` (runs with `--conditions=react-server`).
Testcontainers connects over `127.0.0.1`: Docker Desktop's IPv6 forwarder drops burst connections.
Git commits here need `-c user.name=Dwahnil -c user.email=dwahnilbaria19@gmail.com`.

### Phase 0 record

`docs/SPEC.md` is **complete, Sections 0–35.**

Phase 0 scope (§34): monorepo · ADR template · CI (lint, typecheck, unit tests) · env
validation · Supabase local · migrations for all 35 tables in §9 · RLS baseline +
cross-tenant harness · audit log with hash chain · config tables · design tokens and
base UI components.
**Acceptance:** CI green · RLS harness proves isolation on seeded data · audit chain
verification passes.

Progress — all seven tasks done:

| Task | State |
|---|---|
| Bootstrap (spec, CLAUDE.md, git, `.claude/`, ADR template, REVIEW_ITEMS) | done |
| 1. Monorepo + toolchain (pnpm, strict TS, ESLint, Prettier, Turborepo) | done |
| 2. `packages/core` — money, time, format, identifiers, hashchain, config | done · 140 tests |
| 3. `packages/db` — 11 migrations / 35 tables, RLS, constraints | done · 49 tests |
| 4. Audit log hash chain (writer + paged verifier) | done |
| 5. RLS baseline + cross-tenant harness | done · 16 of the 49 |
| 6. CI (GitHub Actions) | written; not yet run on a runner (no git remote) |
| 7. `packages/ui` — design tokens + numeric presentation | done · 15 tests |

**204 tests, lint and typecheck green.** Summary and ADRs: [docs/plans/phase-0.md](docs/plans/phase-0.md), [docs/adr/](docs/adr/).

Environment notes for a future session:

- `corepack enable pnpm` fails here with EPERM writing to `C:\Program Files\nodejs`.
  pnpm 12.3.4 is installed via `npm i -g pnpm` into the existing user-writable prefix.
- Docker Desktop is a **per-user** install at
  `%LOCALAPPDATA%\Programs\DockerDesktop`, not `Program Files`. A shell started before
  the install has a stale PATH; `packages/db/test/setup-docker-path.ts` repairs it for
  the test worker so Testcontainers can spawn the Docker credential helper.
- Pre-pull `postgres:17-alpine` and `testcontainers/ryuk:0.14.0` if a registry pull
  fails through Docker Desktop's built-in proxy.

### The ten phases (§34)

The product owner waived the stop-for-review gate between phases on 2026-09-13 ("build
everything now"). Plans, summaries and ADRs are still written per phase.

| #   | Phase                                         | State       |
| --- | --------------------------------------------- | ----------- |
| 0   | Foundations                                   | complete |
| 1   | Accounts and security                         | complete (275 tests incl. 5 E2E) |
| 2   | Wallet, pricing, payments, GST                | complete (374 tests + 10 E2E) |
| 3   | Ingestion, Tally, redaction, fixtures         | complete (578 fixtures to ground truth; 50 MB in ~17 s) |
| 4   | AI layer and margin controls                  | complete (49 ai tests; no prompt activated until live evals, R-28) |
| 5   | Semantic layer, mapping, engine, validation   | complete (42 monthly TBs to the paisa; V1–V10 proven) |
| 6   | Jobs, Excel output, lifecycle                 | complete (setup→refresh with zero AI calls, UI E2E; §23 charges; V11) |
| 7   | Dashboard, commentary, reference MIS recreate | complete (V12 post-check; batch commentary; recreated MIS verified by HyperFormula + UI E2E) |
| 8   | Chat                                          | complete (guard corpus + fuzz; server round cap; charged declines; lineage; UI E2E) |
| 9   | Admin console, compliance surfaces, hardening | complete (814 tests + 29 E2E; margin flag E2E; purge shreds every key; cross-tenant, CSP, injection, scrubbing suites; security audit fixed) |

Update this section as each phase completes.

### Definition of done for the whole build (§35)

Every locked decision in §2 enforced in code **and** covered by an automated test · no
path delivering analysis, mapping results, findings or outputs without a captured or
held charge · no path for a browser to send an arbitrary prompt to Anthropic · every
number traceable to a metric ID or query result with lineage · **monthly refresh on
unchanged structure makes zero AI calls** · margin dashboard shows AI cost ratio per
action and flags any over `max_ai_cost_ratio` · all `TODO(review)` items listed in
[docs/REVIEW_ITEMS.md](docs/REVIEW_ITEMS.md) · spec, CLAUDE.md, ADRs, runbooks and help
content current.

---

## The ten working rules (Section 0)

1. Spec lives in `docs/SPEC.md`, verbatim. `CLAUDE.md` holds locked decisions,
   conventions and the current phase, and stays updated as phases complete.
2. **Build in phases, per Section 34.** Write `docs/plans/phase-N.md` at the start of
   each phase; write a summary + ADRs in `docs/adr/NNNN-title.md` at the end, then
   **stop and wait for review.**
3. **Locked decisions are not negotiable.** On conflict, stop and ask. Never silently
   work around one.
4. **Verify every external fact against official docs before implementing it** —
   Anthropic API (params, model IDs, prices, effort, structured outputs, prompt
   caching, batch, token counting), Supabase, Razorpay, SheetJS, DuckDB-WASM,
   ExcelJS, ECharts, Indian GST rules. **Record the doc URL in the ADR. Never guess
   an API shape.** Anthropic docs: https://docs.claude.com/en/api/overview ·
   site map: https://docs.claude.com/en/docs_site_map.md
5. **Never hardcode business numbers.** Prices, packs, tier multipliers, margin
   ratios, limits, retention periods, tax rates, FX rates → config tables/files,
   admin-editable. Spec seed values are illustrative only.
6. Anything the spec calls a placeholder (legal text, TallyPrime menu paths, SAC
   code, final prices) gets a `TODO(review)` marker and is listed in the phase summary.
7. **Tests are part of the work.** A phase is not complete while any test, typecheck
   or lint fails.
8. **No real client data, no secrets, ever committed.** All fixtures synthetic, made
   by scripts in `fixtures/generator`.
9. Small, conventional commits.
10. **Boring dependencies.** Every new dependency gets one line of justification in
    the phase summary.

---

## Locked decisions (Section 2) — not negotiable

1. **Standalone product.** Own brand, infra, Anthropic account, payment gateway
   account, database. No shared code or identity with any other product.
2. **One login per account.** No team members, invitations, roles, organisations,
   sub-users or shared access of any kind. One active session — a new login
   terminates the previous one.
3. **Nothing is free.** No free tier, trial, free generation, free sample on user
   data, or free preview of analysis. Before a paid action the UI may show **only**
   file names, sizes, sheet counts, row counts. Sheet recognition, mapping results,
   data-quality findings and all outputs appear **only inside a paid action**.
   Uncharged: account creation, buying credits, viewing the price book, help docs,
   public marketing samples on fictional data.
4. **Prepaid credits only.** 1 credit = ₹1 ex-GST. No postpaid, no negative balance,
   no credit lines.
5. **Fixed credit price per action** from a configurable price book. Users never see
   tokens, model names or AI cost. Tier multipliers apply.
6. **Margin guardrail.** Every action has `max_ai_cost_ratio` (default 0.20). Estimate
   over cap → user must accept a quote first. Runtime cap hit → job **pauses**. It
   never silently overspends.
7. **Claude never outputs numbers.** Every figure in every output, commentary and chat
   answer is computed by the deterministic engine and inserted via placeholders.
8. **Raw files never leave the browser** by default. Server receives only redacted
   structural profiles, capped redacted samples, and aggregates. Anthropic receives
   only what the server sends for a specific action.
9. **Anthropic API key is server-side only.** Action-specific endpoints only — never a
   generic prompt passthrough. The browser cannot choose prompts, models or token
   limits.
10. **Intelligence tiers, not model names:** Efficient, Professional, Expert. Expert+
    (highest model) is admin-issued quote only, disabled by default.
11. **Chat with the MIS costs credits per message.**
12. **Recurring costs.** Every monthly refresh consumes credits; each active company
    also incurs a monthly company memory fee.
13. **Desktop only.** Latest Chrome, Edge, Firefox. Mobile browsers get a message.
14. **Indian context.** INR + GST on purchases · FY April–March default (per-company
    configurable) · lakhs/crores formatting (absolute and millions options) ·
    **store UTC, display IST** · **dates parsed day-first, never month-first.**

**Business priority: gross margin is the single most important property of this
product.** Every design choice affecting cost or pricing must protect it.

---

## Engineering conventions (Section 4)

- **TypeScript `strict` everywhere.** Zod schemas at _every_ boundary: HTTP, database
  JSON columns, AI inputs and outputs, file parsing results, config.
- **Header-based parsing only.** Never rely on column positions.
- **Time:** stored UTC, displayed IST.
- **Money and quantities:**
  - INR → **integer paise**
  - Credits → **integers**
  - AI cost → **integer micro-USD**, plus the INR equivalent at the FX rate in effect
  - **Never use JS floating point for money**
  - In DuckDB use `DECIMAL(38,4)` or integer paise
- **Idempotency on every mutating operation.** API endpoints take `Idempotency-Key`;
  webhooks de-duplicated by event ID; file imports keyed by content fingerprint.
- **Soft-delete everywhere** (`deleted_at`) + scheduled purge jobs. Purge of encrypted
  company data = **crypto-shredding**: destroy the company's data key.
- **Append-only, hash-chained audit log** (`prev_hash`, `hash`) for auth events, wallet
  mutations, pricing/config changes, admin actions, deletions, consent records. The
  credit ledger is hash-chained too.
- **Environment variables validated at boot with Zod.** The app refuses to start on
  invalid config.
- **Business config lives in the database** with versioning and `effective_from`. Every
  config change is written to the audit log.
- **Tests:** all business rules get unit tests; money and ledger logic gets **property
  tests**.

---

## Trust boundaries (Section 7) — the rule that shapes the codebase

| Zone               | What it is                                | What it may hold                                                                           |
| ------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| **A — Browser**    | Untrusted client                          | Raw files, DuckDB compute, redaction token map (never leaves), Excel + dashboard rendering |
| **B — Our server** | Trusted (Next.js route handlers + worker) | Auth, wallet, pricing, quotes, job state, AI orchestrator, blueprints, snapshots, billing  |
| **C — Anthropic**  | Vendor                                    | Only what an action-specific server function sends                                         |

Enforced:

- No endpoint accepts free-text prompts to forward to Claude. The only free-text AI
  input is a chat message, wrapped in the chat system prompt with scope restrictions.
- Every AI endpoint has a Zod schema and a per-action max payload size. Oversize →
  clear error.
- Model, effort and `max_tokens` are chosen **server-side** from tier routing config.
- The server computes charges **only** from Anthropic usage data it receives directly —
  never from figures reported by the browser.

---

## Stack (Section 5)

Next.js (latest stable, App Router, TS) · Tailwind + shadcn/ui · TanStack Query +
Zustand · Supabase (Postgres, Auth w/ TOTP MFA, Storage, RLS; India/Mumbai region if
available) · Vercel (functions pinned nearest India) · `pg-boss` worker on a container
host · `@anthropic-ai/sdk` (server/worker only) · SheetJS (**official distribution, not
the stale npm registry version**) · DuckDB-WASM · Comlink · OPFS · ExcelJS · Apache
ECharts · HyperFormula (tests) · Razorpay · Resend (ADR 0010) · AES-256-GCM
envelope encryption w/ KMS master key · Vitest + fast-check + Playwright +
Testcontainers · Sentry (PII scrubbing) + pino · pnpm workspaces (+ Turborepo if useful)

Deviating from any default requires documentation showing it cannot meet a requirement,
recorded in an ADR.

---

## Out of scope (Section 3) — do not build

multi-user/teams/roles · client portals or share links · free tier or trial · Tally
desktop connector · scheduled refreshes without a user upload · Zoho/QuickBooks/Busy/
SAP/Google Sheets integrations · mobile apps or layouts · multi-currency · forecasting ·
multi-entity consolidation · Improve/Redesign modes for reference MIS (Recreate only) ·
PDF board pack · Data Vault · budget module · industry KPI packs

**But build for extension:** connectors implement an ingestion interface; templates and
dashboard specs are data; the chat engine can later query stored data.

---

## Repository layout (Section 6)

```
/apps        web (Next.js customer app + API) · admin (separate auth + domain) · worker (pg-boss)
/packages    core · db · wallet · billing · ai · ingest · tally · redact · semantic ·
             engine · templates · render-excel · render-dashboard · chat · ui
/fixtures    generator — synthetic companies + Tally-style exports with ground truth
/docs        SPEC.md · adr/ · plans/ · runbooks/ · help/
```

---

## Toolchain notes (this machine)

- Node **v22.18.0**, npm 10.9.3, pnpm 12.3.4 (see the environment notes under
  "Current phase" for why corepack is not used).
- Windows 11. Shell is PowerShell; a Git Bash is also available. Large heredocs fail
  under Git Bash here — write files with the editor tools, not `cat <<EOF`.
