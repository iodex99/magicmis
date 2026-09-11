---
paths:
  - "packages/db/**"
  - "supabase/**"
---

# Database rules

## Tenancy
- `account_id` is the tenant key on **every** customer table.
- **Every customer table has an RLS policy** restricting rows to the authenticated
  account. A new table without RLS is a security defect, not a follow-up.
- There are **no user-to-user relationships anywhere in the schema** — no teams, roles,
  invitations, orgs or sub-users (SPEC §2.2). Do not add a join table that implies one.
- Admins are a **separate identity system**. An admin is never a customer account.

## Columns
- `created_at`, `updated_at`, and `deleted_at` where applicable. **Soft-delete
  everywhere**; hard removal happens only in scheduled purge jobs.
- Encrypted columns hold AES-256-GCM ciphertext under the **company** or **account** DEK,
  wrapped by the KMS master key. Purge = **crypto-shred** the DEK. Keep re-wrap support
  for master-key rotation.
- Money: integer paise. Credits: integers. AI cost: integer micro-USD + INR equivalent.

## Append-only and hash-chained
`credit_ledger` and `audit_log` carry `prev_hash` / `hash` and have **no UPDATE or
DELETE grant** at the database role level. `blueprints` are versioned and immutable — a
change creates a new version. A later `snapshots` row for the same period creates a new
version and **never overwrites**.

Audit-log these: auth events, wallet mutations, pricing/config changes, admin actions,
deletions, consent records. `audit_log.metadata` carries **no financial data content**.

## Constraints are part of the schema, not the app
`credit_lots.credits_remaining ≥ 0` · `wallets.balance_credits ≥ 0` ·
`held_credits ≥ 0` · `held_credits ≤ balance_credits` ·
`credit_ledger.idempotency_key` UNIQUE · `invoice_counters` row-locked for gapless
per-FY numbering.

## Config lives in the database
`app_config`, `price_book`, `credit_packs`, `model_registry`, `tier_routing` — all
versioned with `effective_from`, all changes audit-logged. **Never hardcode a business
number in application code** (SPEC §0.5).

## Migrations
Forward-only, one concern per migration, reversible where practical. Every migration
that adds a customer table adds its RLS policy in the same migration.
