# ADR 0003 — One tenancy predicate, enforced at two layers

**Status:** accepted · **Date:** 2026-09-11 · **Phase:** 0

## Context

SPEC §9: every customer table carries `account_id` and has an RLS policy restricting rows
to the authenticated account. SPEC §30 requires automated cross-tenant access tests for
every endpoint. SPEC §2.2 is absolute — one login per account, no teams, roles or shared
access anywhere in the schema.

SPEC §9 lists `blueprints`, `snapshots`, `company_keys`, `chat_messages`,
`chat_query_steps` and `outputs` with only `company_id`, while the general rule above the
list says **all** customer tables carry `account_id`.

## Decision

**1. `account_id` on every customer table, including those listed with only
`company_id`.** The general rule governs. Carrying it directly makes each policy a column
comparison rather than a join through `companies` — faster, and impossible to get subtly
wrong in a join condition.

**2. One predicate.** `app.current_account_id()` resolves `auth.uid()` to an account id;
`app.owns(account_id)` wraps it. Every policy in every migration is one call to
`app.owns()`, so tenancy is decided in exactly one place.

`app.current_account_id()` is `SECURITY DEFINER` with `set search_path = ''` and every
name fully qualified:

- **SECURITY DEFINER** is required, not an optimisation: without it, reading
  `public.accounts` from inside a policy *on* `public.accounts` recurses.
- **Empty pinned `search_path`** stops a caller creating a temp table named `accounts` and
  impersonating another tenant. There is a test that attempts exactly this.

**3. Two independent layers.** RLS decides which rows a role may see; **grants** decide
what it may do at all. `authenticated` holds `SELECT` only — every mutation goes through a
server route running as `service_role` inside a locked transaction. A cross-tenant write
is therefore refused at the privilege layer before RLS is consulted.

**4. `FORCE ROW LEVEL SECURITY`** on every tenant table, so the table owner is subject to
its own policies too.

**5. Append-only enforced twice** on `credit_ledger`, `audit_log`, `blueprints`,
`snapshots` and `invoices`: the privilege is revoked **and** a trigger raises. Either
alone suffices; both means dropping one does not silently open the other.

## Verifying documentation

| Fact asserted | URL | Verified on |
|---|---|---|
| `FORCE ROW LEVEL SECURITY` subjects the table owner to its policies; superusers and `BYPASSRLS` roles always bypass | https://www.postgresql.org/docs/17/ddl-rowsecurity.html | 2026-09-11 |
| `SECURITY DEFINER` functions should set a fixed `search_path` to prevent object-shadowing attacks | https://www.postgresql.org/docs/17/sql-createfunction.html | 2026-09-11 |
| `auth.uid()` returns the requesting user's id, NULL when unauthenticated | https://supabase.com/docs/guides/database/postgres/row-level-security | 2026-09-11 |
| Supabase Mumbai region `ap-south-1` ("South Asia (Mumbai)") is available | https://supabase.com/docs/guides/platform/regions | 2026-09-11 |

The Mumbai confirmation closes **R-19** and satisfies SPEC §5's "use an India (Mumbai)
region if available; confirm in docs".

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| `company_id` only, joining to `companies` for tenancy | Every policy becomes a subquery, and one wrong join condition silently opens a tenant. |
| Policy calling `auth.uid()` directly against a per-table `auth_user_id` | Duplicates the account lookup into every table and denormalises identity across 18 tables. |
| RLS alone, with write grants to `authenticated` | Leaves a single mechanism between a bug and a cross-tenant write. |
| Application-level `WHERE account_id = ?` | Correct until one query forgets. RLS cannot forget. |

## Consequences

Easier: adding a table is `account_id` + `enable`/`force` + one `app.owns()` policy. The
harness then covers it automatically, since it enumerates tables from `pg_class`.

Harder: `service_role` bypasses RLS, so every server route must scope its own queries —
the database will not catch a missing filter there. Phase 1 onward must keep the
cross-tenant tests extended to each new endpoint (SPEC §30).

The harness enumerates tables from the catalogue rather than a hardcoded list, so a new
table without RLS fails the suite rather than being quietly missed.
