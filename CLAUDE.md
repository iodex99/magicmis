# Project brain — [PRODUCT_NAME]

Prepaid, usage-priced AI MIS platform for Indian CA firms and SMEs.
Full specification: [docs/SPEC.md](docs/SPEC.md) — **currently incomplete, see "Current phase" below.**

---

## Current phase

**Phase 0 — repository bootstrap. BLOCKED on the remainder of the spec.**

`docs/SPEC.md` is truncated at Section 17 (mid-sentence, at the IFSC detector regex).
Sections 18–33 and **Section 34 (the phase plan)** have not been received.

Instruction 0.2 requires phases to be followed from Section 34, in order. Until that
section exists, **do not start Phase 1 and do not invent a phase plan.** Ask for the
missing sections.

Done so far:
- [x] `docs/SPEC.md` saved (partial, banner-marked)
- [x] `CLAUDE.md` created
- [x] git initialised on `main`; `.gitignore`
- [x] `.claude/` team configuration
- [x] Section 6 directory skeleton
- [ ] Everything else — awaiting Section 34

Update this section as each phase completes.

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

- **TypeScript `strict` everywhere.** Zod schemas at *every* boundary: HTTP, database
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

| Zone | What it is | What it may hold |
|---|---|---|
| **A — Browser** | Untrusted client | Raw files, DuckDB compute, redaction token map (never leaves), Excel + dashboard rendering |
| **B — Our server** | Trusted (Next.js route handlers + worker) | Auth, wallet, pricing, quotes, job state, AI orchestrator, blueprints, snapshots, billing |
| **C — Anthropic** | Vendor | Only what an action-specific server function sends |

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
ECharts · HyperFormula (tests) · Razorpay · Resend *or* Postmark (ADR) · AES-256-GCM
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

- Node **v22.18.0**, npm 10.9.3. **pnpm is not installed** — required by Section 5
  (pnpm workspaces). Install with `corepack enable pnpm` before Phase 1.
- Windows 11. Shell is PowerShell; a Git Bash is also available. Large heredocs fail
  under Git Bash here — write files with the editor tools, not `cat <<EOF`.
