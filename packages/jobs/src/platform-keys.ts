/**
 * Platform data keys: symmetric keys that belong to the platform rather than to an account or
 * company, stored wrapped by the master key in `platform_keys` (migrations 0027, 0031) and moved by
 * the re-wrap job like every other DEK (ADR 0008, ADR 0025).
 */

import type { KeyWrapper } from "@magicmis/crypto";
import type { Queryable } from "@magicmis/db/tx";

export type PlatformKeyPurpose = "library" | "audit_anchor";

/** Created on first use. The caller must zero the returned buffer. */
export async function platformKey(
  db: Queryable,
  wrapper: KeyWrapper,
  purpose: PlatformKeyPurpose,
): Promise<Buffer> {
  // Matches the context the re-wrap job reconstructs: `platform_<purpose>_key`.
  const context = { purpose: `platform_${purpose}_key` };
  const r = await db.query<{ wrapped_dek: Buffer; kms_key_version: string }>(
    `select wrapped_dek, kms_key_version from public.platform_keys where purpose = $1`,
    [purpose],
  );
  const row = r.rows[0];
  if (row !== undefined)
    return wrapper.unwrap(
      { ciphertext: row.wrapped_dek, keyVersion: row.kms_key_version },
      context,
    );
  const { plaintext, wrapped } = await wrapper.generateDataKey(context);
  const inserted = await db.query(
    `insert into public.platform_keys (purpose, wrapped_dek, kms_key_version) values ($1, $2, $3)
     on conflict (purpose) do nothing`,
    [purpose, Buffer.from(wrapped.ciphertext), wrapped.keyVersion],
  );
  if (inserted.rowCount === 1) return plaintext;
  // Another process created it first; use theirs.
  plaintext.fill(0);
  return platformKey(db, wrapper, purpose);
}

export async function platformKeyExists(
  db: Queryable,
  purpose: PlatformKeyPurpose,
): Promise<boolean> {
  const r = await db.query(`select 1 from public.platform_keys where purpose = $1`, [
    purpose,
  ]);
  return r.rows.length > 0;
}
