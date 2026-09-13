# ADR 0006 — Everything in Mumbai: Supabase `ap-south-1`, Vercel `bom1`

**Status:** accepted · **Date:** 2026-09-13 · **Phase:** 0

## Context

SPEC §5 asks for Supabase in an India (Mumbai) region if available, and for Vercel
functions "pinned to the region closest to India". SPEC §33 sets a p95 under 300 ms for
non-AI endpoints. The customers are Indian CA firms and SMEs, and the data is theirs.

Vercel functions default to `iad1` (Washington, D.C.) for new projects. Left alone, every
request from an Indian user would travel to the US East Coast and every database query
would travel back to Mumbai, twice per round trip.

## Decision

| Component | Region |
|---|---|
| Supabase project (Postgres, Auth, Storage) | `ap-south-1`, "South Asia (Mumbai)" |
| Vercel Functions (`apps/web`, `apps/admin`) | `bom1` (Mumbai), set in each app's `vercel.json` as `"regions": ["bom1"]` |
| AWS KMS key (ADR 0008) | `ap-south-1` |
| Worker container host (SPEC §5) | must run in `ap-south-1`; vendor chosen when the worker is built |

Supabase `ap-south-1`, Vercel `bom1` and AWS `ap-south-1` are the same AWS region, so the
function-to-database hop stays inside one region.

`vercel.json` is written when `apps/web` and `apps/admin` are created in Phase 1. The
region goes in the committed file, not only in dashboard settings, so a new project or a
re-import cannot silently fall back to `iad1`.

## Verifying documentation

| Fact asserted | URL | Verified on |
|---|---|---|
| Supabase offers "South Asia (Mumbai)", `ap-south-1` | https://supabase.com/docs/guides/platform/regions | 2026-09-11 |
| Vercel region `bom1` maps to `ap-south-1`, Mumbai | https://vercel.com/docs/regions | 2026-09-13 |
| Vercel Functions default to `iad1` for new projects | https://vercel.com/docs/functions/configuring-functions/region | 2026-09-13 |
| Region set with `"regions"` in `vercel.json`; Hobby allows a single region | https://vercel.com/docs/functions/configuring-functions/region | 2026-09-13 |
| Automatic cross-region function failover is Enterprise-only | https://vercel.com/docs/functions/configuring-functions/region | 2026-09-13 |
| Routing Middleware deploys to all regions regardless of the region setting | https://vercel.com/docs/functions/configuring-functions/region | 2026-09-13 |

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Singapore (`sin1` / `ap-southeast-1`) | Available on both platforms, but further from users and from data they will reasonably expect to stay in India. Mumbai exists, so there is no reason to pick the neighbour. |
| Vercel default `iad1` with Supabase in Mumbai | A trans-Pacific round trip on every query. Would miss §33's latency target and is exactly what §5 tells us to avoid. |
| Multiple function regions | No latency benefit when the database is in one region, and failover across regions is Enterprise-only anyway. |

## Consequences

Easier: a single region for data, compute and keys. A future data-residency question has
a one-line answer.

Harder: a Mumbai-wide outage takes the product down. Automatic function failover is not
available below Enterprise, and failing over functions without the database would not
help. Accepted for this build; recorded here so the runbooks do not assume otherwise.

Routing Middleware runs in every region regardless of the setting, so middleware must not
read from the database or decrypt anything. Auth session checks that need the database
belong in route handlers, which run in `bom1`.
