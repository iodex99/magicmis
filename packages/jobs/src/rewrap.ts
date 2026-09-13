/**
 * Master-key replacement (ADR 0008, SPEC §10 "keep re-wrap support for master-key rotation"). Moves
 * every stored DEK from the previous master key to the new one: unwrap under `from`, wrap under `to`,
 * write back with the new `kms_key_version`. Data encrypted under the DEKs is untouched.
 *
 * Resumable: rows already at `toVersion` are skipped, so a crashed run is simply run again. Destroyed
 * (shredded) keys have no wrapped DEK and are never touched. Runbook: docs/runbooks/key-rotation.md.
 */

import type { EncryptionContext, KeyWrapper } from "@magicmis/crypto";
import type { Queryable } from "@magicmis/db/tx";

interface KeyTable {
  readonly name: string;
  readonly select: string;
  readonly update: string;
  readonly context: (row: Record<string, string>) => EncryptionContext;
}

// Contexts must match the ones used when each key was generated.
const TABLES: readonly KeyTable[] = [
  {
    name: "company_keys",
    select: `select company_id::text as id, account_id::text as account_id, wrapped_dek as wrapped, kms_key_version as version
             from public.company_keys where wrapped_dek is not null and kms_key_version <> $1 and company_id::text > $2
             order by company_id limit $3`,
    update: `update public.company_keys set wrapped_dek = $2, kms_key_version = $3, rotated_at = now()
             where company_id = $1::uuid and kms_key_version = $4 and wrapped_dek is not null`,
    context: (r) => ({
      purpose: "company_dek",
      account_id: r["account_id"] ?? "",
      company_id: r["id"] ?? "",
    }),
  },
  {
    name: "account_keys",
    select: `select account_id::text as id, wrapped_dek as wrapped, kms_key_version as version
             from public.account_keys where wrapped_dek is not null and kms_key_version <> $1 and account_id::text > $2
             order by account_id limit $3`,
    update: `update public.account_keys set wrapped_dek = $2, kms_key_version = $3
             where account_id = $1::uuid and kms_key_version = $4 and wrapped_dek is not null`,
    context: (r) => ({ purpose: "account_dek", account_id: r["id"] ?? "" }),
  },
  {
    name: "platform_keys",
    select: `select purpose as id, wrapped_dek as wrapped, kms_key_version as version
             from public.platform_keys where kms_key_version <> $1 and purpose > $2 order by purpose limit $3`,
    update: `update public.platform_keys set wrapped_dek = $2, kms_key_version = $3
             where purpose = $1 and kms_key_version = $4`,
    context: (r) => ({ purpose: `platform_${r["id"] ?? ""}_key` }),
  },
  {
    name: "admin_users",
    select: `select id::text as id, totp_key_wrapped as wrapped, totp_key_version as version
             from public.admin_users where totp_key_version not in ($1, 'none') and id::text > $2 order by id limit $3`,
    update: `update public.admin_users set totp_key_wrapped = $2, totp_key_version = $3
             where id = $1::uuid and totp_key_version = $4`,
    context: (r) => ({ purpose: "admin_totp", admin_id: r["id"] ?? "" }),
  },
];

export async function rewrapDataKeys(
  db: Queryable,
  from: KeyWrapper,
  to: KeyWrapper,
  toVersion: string,
  batchSize = 200,
): Promise<Record<string, number>> {
  const moved: Record<string, number> = {};
  for (const table of TABLES) {
    let count = 0;
    let after = "";
    for (;;) {
      const r = await db.query<
        { id: string; wrapped: Buffer; version: string } & Record<string, string>
      >(table.select, [toVersion, after, batchSize]);
      if (r.rows.length === 0) break;
      for (const row of r.rows) {
        const context = table.context(row);
        const stored = { ciphertext: row.wrapped, keyVersion: row.version };
        let dek: Buffer;
        try {
          dek = await from.unwrap(stored, context);
        } catch (fromError) {
          // Already under the new key (created during the rotation window with a version string that
          // differs from toVersion): record its version and move on, never abort the run.
          const already = await to.unwrap(stored, context).catch(() => null);
          if (already === null) throw fromError;
          already.fill(0);
          const u = await db.query(table.update, [
            row.id,
            row.wrapped,
            toVersion,
            row.version,
          ]);
          count += u.rowCount ?? 0;
          after = row.id;
          continue;
        }
        try {
          const wrapped = await to.wrap(dek, context);
          const u = await db.query(table.update, [
            row.id,
            Buffer.from(wrapped.ciphertext),
            // One version string per master key, whatever the wrapper reports (see kms.ts).
            toVersion,
            row.version,
          ]);
          count += u.rowCount ?? 0;
        } finally {
          dek.fill(0);
        }
        after = row.id;
      }
    }
    moved[table.name] = count;
  }
  return moved;
}
