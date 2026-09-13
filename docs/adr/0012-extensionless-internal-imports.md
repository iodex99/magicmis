# ADR 0012 — Extensionless relative imports in workspace packages

**Status:** accepted · **Date:** 2026-09-13 · **Phase:** 1

## Context

Phase 0 wrote relative imports with a `.js` extension (`from "./money/brand.js"`), the
NodeNext convention. `apps/web` consumes workspace packages as TypeScript source via
`transpilePackages` (ADR 0001). Next.js 16 builds with Turbopack by default, and the first
production build failed with "Export … doesn't exist in target module" for every such
import: Turbopack did not map the `.js` specifier onto the `.ts` source file.

## Decision

Relative imports inside workspace packages carry **no extension** (`from "./money/brand"`).
`tsconfig.base.json` already uses `moduleResolution: "bundler"`, which permits this, and
Vitest, `tsc` and Turbopack all resolve it. 40 files were converted mechanically.

## Verifying documentation

| Fact asserted | URL | Verified on |
|---|---|---|
| `moduleResolution: "bundler"` allows extensionless relative imports | https://www.typescriptlang.org/tsconfig/#moduleResolution | 2026-09-13 |
| Observed: `next build` (16.3.5, Turbopack) fails on `.js` specifiers for `.ts` sources and succeeds after conversion | local build output | 2026-09-13 |

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Configure Turbopack extension aliasing | Couples every package's import style to one bundler's config, and the next consumer (the worker, the admin app) would need the same workaround. |
| Build each package to JS before use | ADR 0001 rejected per-package build steps; this would reintroduce one to satisfy a specifier convention. |
| Switch Next.js to webpack | Turbopack is the default in Next 16; opting out to keep an import style is the wrong trade. |

## Consequences

Packages are not directly runnable by plain Node ESM, which requires extensions. They never
are run that way: apps bundle them, and tests run under Vitest. If a package is ever
published or executed by bare Node, it will need a build step at that point.
