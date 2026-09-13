# ADR 0008 — AWS KMS in `ap-south-1` as the master key, reached without long-lived credentials

**Status:** accepted · **Date:** 2026-09-13 · **Phase:** 0

## Context

SPEC §5 and §10: AES-256-GCM envelope encryption with per-company data keys (DEKs), wrapped
by a master key held in "a cloud KMS (preferred) or a secrets manager". Account-level fields
use a per-account DEK. Purge is crypto-shredding: destroy the company's DEK. Key rotation
must be supported by re-wrapping DEKs when the master key rotates.

Where the master key lives decides what an attacker needs. If it sits next to the data —
in the same database, or as an environment variable in the same deployment — then one
breach yields both the ciphertext and the means to read it, and the encryption is
decorative.

## Decision

**1. One customer-managed, symmetric AWS KMS key in `ap-south-1`**, the same region as the
database (ADR 0006). It wraps every DEK and never encrypts customer data directly.

**2. DEKs from `GenerateDataKey` with `KeySpec: AES_256`.** The plaintext DEK encrypts data
in Node with AES-256-GCM (SPEC §5) and is erased from memory after use. Only the wrapped
copy (`CiphertextBlob`) is stored, in `account_keys.wrapped_dek` or `company_keys.wrapped_dek`.

**3. Every wrap binds an encryption context** of `{ purpose, account_id, company_id }`.
KMS refuses to unwrap unless the same context is supplied exactly. A wrapped DEK copied
into another company's row — by a bug or by an attacker with write access — therefore fails
to decrypt rather than silently exposing that company's data under the wrong tenant. The
context is logged in CloudTrail in plaintext, so it holds ids only, never names.

**4. Crypto-shredding deletes the wrapped DEK, never the KMS key.** The master key protects
every tenant; scheduling it for deletion would shred all of them. `company_keys` already
enforces this in the schema: `destroyed_at` set requires `wrapped_dek` null.

**5. Automatic rotation enabled**, default 365-day period. KMS decrypts with whichever key
material produced the ciphertext, so rotation needs no re-wrap of existing DEKs. SPEC §10's
re-wrap requirement is still met, for the case rotation does not cover — moving to a new KMS
key after a suspected compromise — with a worker job using `ReEncrypt` and the
`kms_key_version` column to track progress.

**6. No long-lived AWS credentials.** `apps/web` and `apps/admin` on Vercel assume an IAM role
through Vercel's OIDC federation (`@vercel/oidc-aws-credentials-provider`), with the trust
policy scoped to the exact team, project and environment. The worker uses its container
host's role. The role allows `kms:GenerateDataKey` and `kms:Decrypt` on this key only.

**7. `AWS_REGION` pinned explicitly** in every environment. Vercel sets `AWS_REGION` to the
function's execution region, which Vercel's own docs warn can change, and a KMS call to the
wrong region fails because the key does not exist there.

Server env: `KMS_MASTER_KEY_ID` (key ARN or alias, validated), `AWS_REGION` (required),
`AWS_ROLE_ARN` (optional, must be a role ARN — a user ARN is rejected).

## Verifying documentation

| Fact asserted | URL | Verified on |
|---|---|---|
| `GenerateDataKey` returns `Plaintext` and `CiphertextBlob`; `KeySpec` accepts `AES_256`; plaintext should be erased from memory after use | https://docs.aws.amazon.com/kms/latest/APIReference/API_GenerateDataKey.html | 2026-09-13 |
| Decrypting requires the same encryption context, exact and case-sensitive, else `InvalidCiphertextException`; context may appear in plaintext in CloudTrail | same | 2026-09-13 |
| KMS backing keys are "designed never to be exported from the HSM in plaintext" | https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html | 2026-09-13 |
| Automatic rotation for symmetric customer-managed keys, default 365 days, configurable; on-demand rotation also available | https://docs.aws.amazon.com/kms/latest/developerguide/rotate-keys.html | 2026-09-13 |
| Rotation changes only current key material; decrypt transparently uses the original material; rotation does not re-encrypt data keys | same | 2026-09-13 |
| Vercel Functions assume an IAM role via OIDC (`sts:AssumeRoleWithWebIdentity`) using `@vercel/oidc-aws-credentials-provider` and `AWS_ROLE_ARN` | https://vercel.com/docs/oidc/aws | 2026-09-13 |
| Vercel sets `AWS_REGION` to the execution region, which is not stable; declare it explicitly | same | 2026-09-13 |

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Master key as a secret in Vercel env or a secrets manager | Anyone who can read the deployment's secrets can unwrap every DEK offline, with no audit trail. With KMS the key never leaves the HSM, and every unwrap is a logged API call that can be revoked by removing a role. |
| Supabase Vault | Keeps the key in the same Postgres as the ciphertext — one breach yields both. Defeats the separation SPEC §10 is asking for. |
| Google Cloud KMS or Azure Key Vault | Both viable, but the data already lives in AWS `ap-south-1` via Supabase. Another cloud adds a second IAM system for no gain. |
| One KMS key per company | Real crypto-shred via key deletion, but each customer-managed key carries a monthly fee, so cost would scale with customer count on a margin-first product. A per-company DEK gives the same shred property at no per-company cost. |
| Encrypt data directly with KMS `Encrypt` | Every read and write becomes a network call and is subject to KMS request quotas. Envelope encryption calls KMS once per DEK unwrap. |

## Consequences

Easier: the database alone is useless to an attacker; so is a leaked env file. Access is
revocable in one place and every unwrap is audited in CloudTrail.

Harder: every decrypt path needs a KMS round trip to unwrap its DEK. Unwrapped DEKs will be
cached in memory for the life of a request — never across requests or tenants — and that
cache must be designed in Phase 2, when encrypted columns are first written.

Tests must not call real KMS. Phase 2 introduces a `KeyWrapper` interface with a local
AES-GCM implementation for tests that enforces the encryption-context check the same way,
so a test cannot pass by skipping the check KMS would apply.

KMS request quotas and per-key pricing are an operating cost to track on the margin
dashboard. The mitigation is keeping unwraps to one per DEK per request.
