# ADR 0001 — pnpm workspaces with Turborepo

**Status:** accepted · **Date:** 2026-09-11 · **Phase:** 0

## Context

SPEC §5 names pnpm workspaces, "plus Turborepo if useful". SPEC §6 defines 3 apps and 15
packages that share `@magicmis/core`, so a package manager with proper workspace linking
and a task runner that understands the dependency graph are both load-bearing.

## Decision

pnpm workspaces over `apps/*`, `packages/*` and `fixtures/generator`, with Turborepo
driving `lint`, `typecheck`, `test` and `build`.

Internal packages are consumed **as TypeScript source** — `main` points at
`src/index.ts`, there is no per-package build step, and `typecheck` runs `tsc --noEmit`.
With 15 packages, a build step for each would add minutes to every run for no benefit;
Next.js and Vitest both transpile workspace sources directly.

`tsconfig.base.json` goes beyond `strict`, adding `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`,
`noFallthroughCasesInSwitch` and `noPropertyAccessFromIndexSignature`.

ESLint additionally bans `parseFloat`, `Number(...)` as a call, and `Math.round`, and
errors on floating promises.

## Verifying documentation

| Fact asserted | URL | Verified on |
|---|---|---|
| pnpm 12 requires explicit approval for dependency build scripts | https://pnpm.io/settings#onlybuiltdependencies | 2026-09-11 |
| Turborepo task/`dependsOn` schema | https://turborepo.com/docs/reference/configuration | 2026-09-11 |

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| npm workspaces | No strict node_modules isolation, so a package can import a dependency it never declared. That is how a package quietly acquires an undeclared dependency on `@magicmis/core`. |
| Nx | More capable than needed, and its plugin model is a larger thing to learn and keep current than the task graph this repo actually needs. |
| Per-package build step | Minutes added to every run across 15 packages, to produce artefacts nothing consumes. |
| Default `strict` only | `noUncheckedIndexedAccess` is what turns `rows[0].id` into a compile error. In a wallet or parser path, that silent `undefined` becomes a wrong number. |

## Consequences

Easier: one command runs everything; a package cannot import an undeclared dependency;
adding a package is a directory plus a manifest.

Harder: `exactOptionalPropertyTypes` makes `{ foo: undefined }` and `{}` distinct types,
which is occasionally irritating around optional config — but that distinction is exactly
what stops `undefined` being written into an encrypted column.

Also harder: publishing any of these packages externally would now need a build step
added. Nothing in SPEC §3's extension list requires that.

The `Math.round` ban has already paid for itself once, catching a float rounding step in
the Excel serial date conversion that turned out to be unnecessary — the arithmetic was
exact.
