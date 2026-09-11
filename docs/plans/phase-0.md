# Phase 0 — Foundations

Scope from SPEC §34:

> - Monorepo, CLAUDE.md, ADR template, CI (lint, typecheck, unit tests), env validation.
> - Supabase local, migrations for all tables in Section 9, RLS baseline + cross-tenant
>   test harness.
> - Audit log with hash chain; config tables; design tokens and base UI components.
> - *Acceptance:* CI green; RLS harness proves isolation on seeded data; audit chain
>   verification passes.

No product features in this phase. No auth flows (Phase 1), no wallet logic (Phase 2) —
only the tables those phases will fill.

---

## 0.a — Already done (pre-phase bootstrap)

Completed before the spec was fully in hand:

- `docs/SPEC.md` — Sections 0–35, verbatim. Arrived in three deliveries, each capped at
  the 50,000-character message limit; the third arrived with markdown flattened and was
  restored to the document's own conventions, wording unaltered.
- `CLAUDE.md` — locked decisions (§2), engineering conventions (§4), trust boundaries
  (§7), stack (§5), out-of-scope (§3), layout (§6), current phase.
- git on `main`; `.gitignore`; `.gitattributes` forcing LF (Windows `core.autocrlf`
  would otherwise rewrite the hook scripts to CRLF and break bash).
- `.claude/` — four path-scoped rules, six agents, three commands, an `indian-finance`
  skill, two hooks. Hook paths tested: non-commit passes (0), commit without
  `package.json` skips with a notice (0), staged `.env` blocks (2).
- Section 6 directory skeleton (`.gitkeep` only).

Carried forward: the `/phase-start` command originally stopped for review after writing
the plan. §0.2 and §34 put the gate at the **end** of a phase, so that has been
corrected to match the spec.

---

## 0.b — Tasks

### 1. Monorepo and toolchain
- `corepack enable pnpm` (pnpm absent on this machine; Node v22.18.0, npm 10.9.3 present).
- `pnpm-workspace.yaml` over `apps/*` and `packages/*`; root `package.json`;
  Turborepo pipeline for `lint`, `typecheck`, `test`, `build`.
- Shared `tsconfig.base.json` — `strict: true`, plus `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`. ESLint flat config + Prettier.
- Stub `package.json` + `tsconfig.json` in each of the 15 packages and 3 apps so the
  graph resolves. No implementation beyond what later tasks need.

### 2. `packages/core`
- `money/` — integer paise and micro-USD types with unit-suffixed branded types, so a
  paise value cannot be passed where rupees are expected. Parse, format, add, multiply
  by ratio, divide with explicit rounding mode. **No float path exists.**
- `time/` — UTC storage, IST display, FY helpers driven by `fy_start_month` (never a
  hardcoded April), period IDs (`YYYY-MM`), day-first date parsing.
- `format/` — Indian digit grouping (`1,00,000`), lakhs/crores/absolute/millions modes,
  configurable decimals, parentheses-negative.
- `identifiers/` — PAN shape, **GSTIN with checksum**, Aadhaar Verhoeff, IFSC.
- `hashchain/` — `prev_hash`/`hash` computation and chain verification, shared by
  `audit_log`, `credit_ledger` and `blueprints`.
- `config/` — Zod-validated env loader. **The app refuses to start on invalid config**
  (§4). Typed accessor for DB-backed `app_config` with `effective_from` resolution.

### 3. `packages/db` — migrations for all 35 tables in §9
Grouped, forward-only, each customer table's RLS policy in the **same** migration:

| Migration | Tables |
|---|---|
| `0001_identity` | accounts, login_events, consents, account_keys |
| `0002_companies` | companies, company_keys, blueprints, account_mapping_rules, snapshots |
| `0003_semantic` | mis_heads, global_mapping_library, library_candidates *(global, not tenant)* |
| `0004_jobs_ai` | jobs, job_stage_outputs, ai_calls, quotes, estimator_calibration |
| `0005_wallet` | price_book, credit_packs, credit_lots, wallets, reservations, credit_ledger |
| `0006_billing` | purchases, invoices, invoice_counters |
| `0007_chat_outputs` | chat_threads, chat_messages, chat_query_steps, outputs |
| `0008_notify_audit` | notifications, audit_log |
| `0009_config` | app_config, model_registry, tier_routing |
| `0010_grants` | revoke UPDATE/DELETE on `credit_ledger` and `audit_log` at the role level |

Constraints go in the schema, not the app: `credit_lots.credits_remaining ≥ 0`;
`wallets.balance_credits ≥ 0`, `held_credits ≥ 0`, `held_credits ≤ balance_credits`;
`credit_ledger.idempotency_key` UNIQUE; `invoice_counters` row-lockable.

Seeds (values only, all admin-editable, all `TODO(review)`): price book, credit packs,
app_config defaults, model registry, tier routing.

### 4. Audit log with hash chain
- Append-only writer taking actor, action, target, metadata. **Metadata carries no
  financial data content** (§9).
- Nightly verification job skeleton; alerts on mismatch (§30).

### 5. RLS baseline + cross-tenant harness
- Every customer table: `account_id`, policy scoped to the authenticated account.
- Harness seeds two accounts with overlapping-looking data and asserts, per table, that
  account A cannot read, update or delete account B's rows — including through the
  service-role path used by the worker.

### 6. CI
- GitHub Actions: `pnpm lint`, `pnpm typecheck`, `pnpm test`, migrations applied against
  a throwaway Postgres, RLS harness, audit-chain verification. Lockfile enforced.
- Secret + dependency scanning (§30). The client-bundle secret scan lands in Phase 4
  when there is a bundle to scan.

### 7. `packages/ui` — design tokens and base components
Per §32: precise and calm; **no emojis, no sparkle icons, no purple-blue gradients, no
"magic" wording, no glowing effects, no gradient blobs.** Restrained neutral palette,
one accent. Red/green only for variance, **always paired with a sign or arrow** so
meaning never depends on colour. **Tabular numerals, numbers right-aligned.**
WCAG 2.2 AA, full keyboard operability.

Components: Button, Input, Select, Checkbox, Dialog, Table (sticky header, compact
density), Badge, Alert, Tabs, Toast, `AmountCell`, `VarianceCell`.

---

## 0.c — Tests

- **Property (fast-check):** paise arithmetic never loses value; format→parse round-trips;
  hash chain verifies and any mutation breaks it; FY/period maths across the April
  boundary and leap years.
- **Unit:** GSTIN checksum (valid and invalid), Aadhaar Verhoeff, PAN, IFSC; Indian
  grouping across magnitudes; day-first parsing of `1-Apr-25`, `01-04-2025`,
  `01/04/2025`, Excel serials; **explicit assertions that no input is read month-first**;
  env loader rejects malformed config.
- **Integration (Testcontainers Postgres):** migrations apply clean and are idempotent;
  every constraint rejects its violation; `credit_ledger`/`audit_log` reject UPDATE and
  DELETE at the role level.
- **Security:** the cross-tenant harness, per table.

---

## 0.d — External facts to verify before implementing (§0.4)

| Fact | Source | ADR |
|---|---|---|
| Supabase India (Mumbai) region availability | supabase.com/docs | 0002 |
| Supabase local stack + TOTP MFA support | supabase.com/docs | 0002 |
| Vercel region nearest India for functions | vercel.com/docs | 0002 |
| pg-boss version, schema needs, Postgres compatibility | pg-boss docs | 0003 |
| Postgres RLS + service-role interaction | supabase.com/docs | 0004 |

Anthropic, Razorpay, SheetJS, DuckDB-WASM, ExcelJS, ECharts and GST facts are verified
in the phases that use them (4, 2, 3, 3, 6, 7, 2 respectively).

## 0.e — Decisions to record as ADRs

| # | Decision |
|---|---|
| 0001 | ADR template and numbering |
| 0002 | Hosting and region: Supabase region, Vercel function region |
| 0003 | Monorepo tooling: pnpm workspaces, Turborepo yes/no |
| 0004 | RLS strategy and how the worker's service-role path stays tenant-safe |
| 0005 | Branded integer money types instead of a decimal library |
| 0006 | Hash-chain construction (field order, encoding, hash function) |
| 0007 | Email provider — Resend or Postmark (§5 requires a choice + ADR) |
| 0008 | KMS vs secrets manager for the master key |
| 0009 | Social login offered or not (§8 requires the decision recorded) |

## 0.f — Proposed dependencies

Each gets its one-line justification in the phase summary (§0.10). Expected: `zod`,
`typescript`, `eslint`, `prettier`, `vitest`, `fast-check`, `@testcontainers/postgresql`,
`postgres` or `pg`, `turbo`, `tailwindcss`, `@radix-ui/*` via shadcn/ui, `clsx`,
`tailwind-merge`. Nothing outside this list without a note.

## 0.g — Open questions

Not blocking — I will proceed on the stated assumption and record it in the ADR.

1. **Product name.** The spec says `[PRODUCT_NAME]` throughout; the directory is
   `magicmis`. I will use a single `PRODUCT_NAME` constant in `packages/core` so the
   real name is a one-line change, and will not bake a name into copy.
   *Note:* §32 forbids "magic" wording in the UI, which sits awkwardly with "MagicMIS"
   as a customer-facing brand. Flagging, not deciding.
2. **Seller GSTIN, legal name, address, SAC code** — needed for §13 invoices in Phase 2,
   not Phase 0. Tracked in `docs/REVIEW_ITEMS.md`.
3. **Email provider** — I will pick Resend (simpler API, adequate deliverability for
   transactional-only volume) unless told otherwise, and record ADR 0007.

## 0.h — Acceptance

Per §34: CI green · RLS harness proves isolation on seeded data · audit chain
verification passes. Then `/phase-end 0` and stop for review.

---

# Phase 0 summary

**Status: complete, pending your review.** 204 tests, lint and typecheck green across
three packages.

## Acceptance criteria (§34)

| Criterion | Result |
|---|---|
| CI green | Workflow written and the identical commands pass locally (`format:check`, `lint`, `typecheck`, `test`). **Not yet observed on a runner** — there is no git remote, so nothing has executed in Actions. |
| RLS harness proves isolation on seeded data | **Met.** 16 tests, two seeded tenants, real Postgres 17. |
| Audit chain verification passes | **Met.** 9 tests including 30-way concurrent appends and tamper detection. |

## What was built

| Package | Contents | Tests |
|---|---|---|
| root | pnpm workspaces, Turborepo, strict TS, ESLint, Prettier, CI, `.gitattributes` | — |
| `@magicmis/core` | money · time · format · identifiers · hashchain · config | 140 |
| `@magicmis/db` | 11 migrations / 35 tables, RLS, audit writer + verifier, migration runner, Testcontainers harness | 49 |
| `@magicmis/ui` | design tokens, numeric/variance presentation | 15 |

Plus `docs/adr/0000`–`0005` and `docs/REVIEW_ITEMS.md`.

## Bugs the tests caught

Three, all of which would have shipped:

1. **`audit_log` ordered by `(created_at, id)`.** `created_at` defaults to `now()` —
   transaction-*start* time — so rapid appends tie, and the tie-break was a **random**
   uuid. The tail lookup could pick the wrong row and break the chain under ordinary
   traffic, not tampering. Replaced with a `bigserial`.
2. **`select seq::text as seq ... order by seq`.** Postgres resolves `ORDER BY` to the
   *output* column, so the verifier walked `1,10,11,…,2,20` lexicographically. Passed at
   8 rows (1–9 sort identically either way), failed at 25.
3. **`audit_log` missing from the privilege revoke list.** RLS already returned nothing,
   but relying on "no policy" alone means a policy added later for one purpose silently
   opens it for all.

A fourth finding was not a bug: cross-tenant writes are refused at the **privilege**
layer, because `authenticated` holds no UPDATE/DELETE grant at all — stronger than the
test asserted. The tests now assert the property (row unchanged) rather than the
mechanism.

## Deviations from the plan

- **Testcontainers instead of the Supabase local stack** for Phase 0 — ADR 0005.
  SPEC §5 permits either; Phase 0 exercises no Supabase service beyond Postgres.
- **`account_id` added to `blueprints`, `snapshots`, `company_keys`, `chat_messages`,
  `chat_query_steps` and `outputs`**, which §9 lists with only `company_id`. The general
  rule above that list ("all customer tables carry account_id") governs — ADR 0003.
- **ADRs 0006–0009 not written.** They were planned for the email provider, KMS choice,
  social login and region. An ADR records a decision taken; none of those has code
  depending on it yet, and writing one now would record a guess. The region question is
  resolved and recorded inside ADR 0003.

## New dependencies (§0.10 — one line each)

| Dependency | Justification |
|---|---|
| `typescript`, `eslint`, `typescript-eslint`, `@eslint/js`, `prettier` | The toolchain SPEC §4 and §5 require. |
| `turbo` | Task graph across 18 workspace packages; SPEC §5 names it. |
| `vitest`, `fast-check` | SPEC §5 names both; property tests are mandatory for money and ledger logic. |
| `zod` | SPEC §4 requires Zod at every boundary. |
| `pg`, `@types/pg` | The boring, maintained Postgres driver. |
| `@testcontainers/postgresql` | SPEC §5 names it; RLS cannot be proven against a mock. |

## `TODO(review)` raised this phase (§0.6)

One new: **R-20**, the GSTIN check-character algorithm, needing confirmation against
official GSTN documentation before Phase 2. It reproduces the check character on two
independent specimen GSTINs and passes a generated-check-character property test, but
§0.4 does not accept an external fact without a source.

One closed: **R-19** — Supabase Mumbai (`ap-south-1`) confirmed available.

## What Phase 1 depends on

Schema and RLS are in place, so Phase 1 adds auth flows on top rather than alongside.
Two carried-forward obligations:

1. **Verify the auth shim against the real thing.** When Supabase local arrives for Auth,
   run the RLS policies against it once to confirm the shim and the genuine `auth.uid()`
   agree (ADR 0005).
2. **`service_role` bypasses RLS**, so every server route must scope its own queries. The
   cross-tenant tests must be extended to each new endpoint as it lands (SPEC §30).

## Open, and not blocking

Unchanged from §0.g: product name (R-01), and the email provider (R-16, proceeding with
Resend unless told otherwise). Neither has code depending on it yet.
