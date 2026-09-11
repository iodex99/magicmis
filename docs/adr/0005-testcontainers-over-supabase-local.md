# ADR 0005 — Testcontainers Postgres for the RLS harness, not the Supabase local stack

**Status:** accepted · **Date:** 2026-09-11 · **Phase:** 0

> **This records a deviation from SPEC §34.** Phase 0's scope line says "Supabase local".
> SPEC §5 permits either: "Supabase local stack **or** Testcontainers Postgres for
> integration and concurrency tests."

## Context

Phase 0's acceptance criteria are: CI green, the RLS harness proves isolation on seeded
data, and audit chain verification passes. All three need a real Postgres — RLS is a
question about what the *database* does with a policy under a given role, and no mock can
answer it.

The Supabase local stack additionally provides Auth, Storage, PostgREST and Studio. None
of those is exercised by Phase 0; Auth first matters in Phase 1.

## Decision

Run the Phase 0 suite against `postgres:17-alpine` via `@testcontainers/postgresql`, with
a minimal `auth.uid()` shim applied by the harness only.

Each test file boots its own container and applies every migration, so a suite always runs
against the schema as the migrations actually produce it — not against a database that has
drifted through months of local use.

**The shim is deliberately minimal.** Supabase does not publish `auth.uid()`'s SQL
definition, so the shim implements the documented *contract* over the documented claims
mechanism, and nothing else. An earlier draft also defined `auth.role()`; that is **not a
documented Supabase function** and nothing in the migrations uses it, so it was removed.
Inventing helpers in a fidelity shim is precisely how it starts proving things about
itself instead of about production.

Supabase local remains the right tool from Phase 1, where Auth is under test. This ADR
does not replace it — it scopes it.

## Verifying documentation

| Fact asserted | URL | Verified on |
|---|---|---|
| SPEC §5 permits Testcontainers Postgres as an alternative to the Supabase local stack | `docs/SPEC.md` §5 | 2026-09-11 |
| `auth.uid()` returns the requesting user's id, NULL when unauthenticated | https://supabase.com/docs/guides/database/postgres/row-level-security | 2026-09-11 |
| JWT claims reach SQL via PostgREST's transaction-scoped `request.jwt.claims`, read as `current_setting('request.jwt.claims', true)::json->>'sub'` | https://docs.postgrest.org/en/stable/references/transactions.html | 2026-09-11 |

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Supabase local stack for Phase 0 | Requires the Supabase CLI as an extra toolchain dependency and boots Auth, Storage, PostgREST, Studio and more, none of which Phase 0 exercises. Slower per run, and a long-lived local database drifts from the migrations. |
| A single shared Postgres container for the whole suite | Cross-file state leakage: the audit-chain suite's row counts would depend on what the RLS suite left behind. |
| PGlite (Postgres in WASM) | Zero install and real RLS semantics, but not one of the two options SPEC §5 allows, and cannot cover Phase 2's requirement that concurrency tests run against real Postgres. |
| A mocked database | Cannot answer the question. RLS behaviour is the thing under test. |

## Consequences

Easier: the suite is hermetic and CI-friendly — GitHub Actions runners have Docker, so the
same command works locally and in CI.

Harder: the suite needs a working Docker daemon, and each file pays container start-up
(~5–10s). `fileParallelism` is disabled because parallel Postgres containers contend for
memory on a laptop and make failures look flaky.

Two environment sharp edges were found and handled:

- Testcontainers spawns `docker-credential-desktop` to resolve registry credentials. That
  helper lives in Docker Desktop's bin directory, which the installer adds to PATH — but a
  shell or CI agent started *before* the install has a stale PATH and fails with ENOENT
  before any container starts. `test/setup-docker-path.ts` repairs it, checking the
  per-user install location as well as `Program Files`, since Docker Desktop on Windows now
  installs per-user by default.
- Pulling Ryuk by digest failed once through Docker Desktop's built-in HTTP proxy while a
  tag pull succeeded. CI pre-pulls both images in a named step, so a registry failure is
  legible as itself rather than as a mysterious test timeout.

**Carried forward to Phase 1:** the shim must be kept honest. When Supabase local is
introduced for Auth, the RLS policies should be run against it at least once to confirm the
shim and the real `auth.uid()` agree.
