/**
 * Company memory storage (SPEC §9, §10, §20): blueprints and snapshots, encrypted under the
 * company's data key (envelope encryption, ADR 0008). Server and worker only.
 *
 * - The company DEK is created on first use, stored only wrapped, and destroyed on purge
 *   (crypto-shredding); a destroyed key refuses every read and write.
 * - Blueprints are versioned, immutable (a database trigger forbids updates) and hash-chained per
 *   company over digests of their plaintext parts.
 * - Snapshots never overwrite: a later snapshot for a period is a new version.
 * - Each encrypted column binds its own context (company, account, purpose, version), so a
 *   ciphertext moved to another row or tenant fails to decrypt.
 */

import "server-only";

import { createHash } from "node:crypto";

import { computeHash, GENESIS_HASH } from "@magicmis/core/hashchain";
import {
  decryptWithKey,
  encryptWithKey,
  type EncryptionContext,
  type KeyWrapper,
} from "@magicmis/crypto";
import { withTransaction, type Queryable } from "@magicmis/db/tx";
import type { Pool } from "pg";

import { snapshotPayloadSchema, type SnapshotPayload } from "./snapshot";

export class CompanyKeyDestroyed extends Error {
  constructor(companyId: string) {
    super(`company ${companyId} data key has been destroyed`);
    this.name = "CompanyKeyDestroyed";
  }
}

const keyContext = (accountId: string, companyId: string): EncryptionContext => ({
  purpose: "company_dek",
  account_id: accountId,
  company_id: companyId,
});

async function companyDek(
  db: Queryable,
  wrapper: KeyWrapper,
  accountId: string,
  companyId: string,
): Promise<Buffer> {
  const r = await db.query<{
    wrapped_dek: Buffer | null;
    kms_key_version: string;
    destroyed_at: Date | null;
    account_id: string;
  }>(
    `select wrapped_dek, kms_key_version, destroyed_at, account_id from public.company_keys where company_id = $1 for update`,
    [companyId],
  );
  const row = r.rows[0];
  if (row !== undefined) {
    if (row.account_id !== accountId)
      throw new Error("company does not belong to this account");
    if (row.destroyed_at !== null || row.wrapped_dek === null)
      throw new CompanyKeyDestroyed(companyId);
    return wrapper.unwrap(
      { ciphertext: row.wrapped_dek, keyVersion: row.kms_key_version },
      keyContext(accountId, companyId),
    );
  }
  const owner = await db.query(
    `select 1 from public.companies where id = $1 and account_id = $2 and deleted_at is null`,
    [companyId, accountId],
  );
  if (owner.rowCount !== 1) throw new Error("company not found for this account");
  const { plaintext, wrapped } = await wrapper.generateDataKey(
    keyContext(accountId, companyId),
  );
  await db.query(
    `insert into public.company_keys (company_id, account_id, wrapped_dek, kms_key_version) values ($1, $2, $3, $4)`,
    [companyId, accountId, Buffer.from(wrapped.ciphertext), wrapped.keyVersion],
  );
  return plaintext;
}

const digest = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

const partContext = (
  accountId: string,
  companyId: string,
  purpose: string,
  version: number,
  period = "",
): EncryptionContext => ({
  purpose,
  account_id: accountId,
  company_id: companyId,
  version: version.toString(),
  period,
});

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export async function storeSnapshot(
  pool: Pool,
  wrapper: KeyWrapper,
  input: {
    accountId: string;
    companyId: string;
    jobId: string | null;
    payload: SnapshotPayload;
  },
): Promise<{ snapshotId: string; version: number }> {
  const payload = snapshotPayloadSchema.parse(input.payload);
  return withTransaction(pool, async (tx) => {
    const dek = await companyDek(tx, wrapper, input.accountId, input.companyId);
    try {
      const v = await tx.query<{ next: number }>(
        `select coalesce(max(version), 0) + 1 as next from public.snapshots where company_id = $1 and period = $2`,
        [input.companyId, payload.period],
      );
      const version = v.rows[0]?.next ?? 1;
      const ctx = (purpose: string) =>
        partContext(input.accountId, input.companyId, purpose, version, payload.period);
      const balances = encryptWithKey(
        dek,
        Buffer.from(JSON.stringify(payload.ledgerBalances)),
        ctx("snapshot.ledger_balances"),
      );
      const metrics = encryptWithKey(
        dek,
        Buffer.from(JSON.stringify(payload.metricStore)),
        ctx("snapshot.metric_store"),
      );
      const r = await tx.query<{ id: string }>(
        `insert into public.snapshots
           (company_id, account_id, period, version, ledger_balances, metric_store, validation_results, source_fingerprint, engine_version, created_by_job_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [
          input.companyId,
          input.accountId,
          payload.period,
          version,
          balances,
          metrics,
          JSON.stringify(payload.validationResults),
          payload.sourceFingerprint,
          payload.engineVersion,
          input.jobId,
        ],
      );
      const snapshotId = r.rows[0]?.id;
      if (snapshotId === undefined) throw new Error("snapshot insert returned no id");
      return { snapshotId, version };
    } finally {
      dek.fill(0);
    }
  });
}

export async function latestSnapshot(
  pool: Pool,
  wrapper: KeyWrapper,
  input: { accountId: string; companyId: string; period: string },
): Promise<
  (Pick<SnapshotPayload, "ledgerBalances" | "metricStore"> & { version: number }) | null
> {
  return withTransaction(pool, async (tx) => {
    const r = await tx.query<{
      version: number;
      ledger_balances: Buffer;
      metric_store: Buffer;
    }>(
      `select version, ledger_balances, metric_store from public.snapshots
       where company_id = $1 and account_id = $2 and period = $3 order by version desc limit 1`,
      [input.companyId, input.accountId, input.period],
    );
    const row = r.rows[0];
    if (row === undefined) return null;
    const dek = await companyDek(tx, wrapper, input.accountId, input.companyId);
    try {
      const ctx = (purpose: string) =>
        partContext(input.accountId, input.companyId, purpose, row.version, input.period);
      const ledgerBalances = snapshotPayloadSchema.shape.ledgerBalances.parse(
        JSON.parse(
          decryptWithKey(
            dek,
            row.ledger_balances,
            ctx("snapshot.ledger_balances"),
          ).toString("utf8"),
        ),
      );
      const metricStore = snapshotPayloadSchema.shape.metricStore.parse(
        JSON.parse(
          decryptWithKey(dek, row.metric_store, ctx("snapshot.metric_store")).toString(
            "utf8",
          ),
        ),
      );
      return { version: row.version, ledgerBalances, metricStore };
    } finally {
      dek.fill(0);
    }
  });
}

// ---------------------------------------------------------------------------
// Blueprints
// ---------------------------------------------------------------------------

export interface BlueprintParts {
  readonly templateSpec: unknown;
  readonly recipe: unknown;
  readonly mappingRules: unknown;
  readonly dashboardSpec: unknown;
  readonly materiality: Readonly<Record<string, string>>;
  readonly sourceFingerprints: Readonly<Record<string, string>>;
}

const PARTS = [
  ["templateSpec", "template_spec"],
  ["recipe", "recipe"],
  ["mappingRules", "mapping_rules"],
  ["dashboardSpec", "dashboard_spec"],
] as const;

function chainPayload(
  companyId: string,
  version: number,
  plain: Record<string, Buffer | null>,
  parts: BlueprintParts,
) {
  return {
    company_id: companyId,
    version,
    template_spec_sha256: plain["template_spec"] ? digest(plain["template_spec"]) : "",
    recipe_sha256: plain["recipe"] ? digest(plain["recipe"]) : "",
    mapping_rules_sha256: plain["mapping_rules"] ? digest(plain["mapping_rules"]) : "",
    dashboard_spec_sha256: plain["dashboard_spec"] ? digest(plain["dashboard_spec"]) : "",
    materiality: { ...parts.materiality },
    source_fingerprints: { ...parts.sourceFingerprints },
  };
}

export async function storeBlueprint(
  pool: Pool,
  wrapper: KeyWrapper,
  input: {
    accountId: string;
    companyId: string;
    jobId: string | null;
    parts: BlueprintParts;
  },
): Promise<{ blueprintId: string; version: number; hash: string }> {
  return withTransaction(pool, async (tx) => {
    const dek = await companyDek(tx, wrapper, input.accountId, input.companyId);
    try {
      const last = await tx.query<{ version: number; hash: string }>(
        `select version, hash from public.blueprints where company_id = $1 order by version desc limit 1`,
        [input.companyId],
      );
      const version = (last.rows[0]?.version ?? 0) + 1;
      const prevHash = last.rows[0]?.hash ?? GENESIS_HASH;
      const plain: Record<string, Buffer | null> = {};
      const sealed: Record<string, Buffer | null> = {};
      for (const [field, column] of PARTS) {
        const value = input.parts[field];
        const bytes =
          value === null || value === undefined
            ? null
            : Buffer.from(JSON.stringify(value));
        plain[column] = bytes;
        sealed[column] =
          bytes === null
            ? null
            : encryptWithKey(
                dek,
                bytes,
                partContext(
                  input.accountId,
                  input.companyId,
                  `blueprint.${column}`,
                  version,
                ),
              );
      }
      const hash = computeHash(
        prevHash,
        chainPayload(input.companyId, version, plain, input.parts),
      );
      const r = await tx.query<{ id: string }>(
        `insert into public.blueprints
           (company_id, account_id, version, template_spec, recipe, mapping_rules, dashboard_spec, materiality, source_fingerprints, created_by_job_id, prev_hash, hash)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
        [
          input.companyId,
          input.accountId,
          version,
          sealed["template_spec"],
          sealed["recipe"],
          sealed["mapping_rules"],
          sealed["dashboard_spec"],
          JSON.stringify(input.parts.materiality),
          JSON.stringify(input.parts.sourceFingerprints),
          input.jobId,
          prevHash,
          hash,
        ],
      );
      const blueprintId = r.rows[0]?.id;
      if (blueprintId === undefined) throw new Error("blueprint insert returned no id");
      return { blueprintId, version, hash };
    } finally {
      dek.fill(0);
    }
  });
}

interface BlueprintRow {
  version: number;
  template_spec: Buffer;
  recipe: Buffer;
  mapping_rules: Buffer;
  dashboard_spec: Buffer | null;
  materiality: Record<string, string>;
  source_fingerprints: Record<string, string>;
  prev_hash: string;
  hash: string;
}

function openBlueprint(
  dek: Buffer,
  row: BlueprintRow,
  accountId: string,
  companyId: string,
) {
  const plain: Record<string, Buffer | null> = {};
  const values: Record<string, unknown> = {};
  for (const [field, column] of PARTS) {
    const sealed = row[column];
    if (sealed === null) {
      plain[column] = null;
      values[field] = null;
      continue;
    }
    const bytes = decryptWithKey(
      dek,
      sealed,
      partContext(accountId, companyId, `blueprint.${column}`, row.version),
    );
    plain[column] = bytes;
    values[field] = JSON.parse(bytes.toString("utf8")) as unknown;
  }
  const parts: BlueprintParts = {
    templateSpec: values["templateSpec"],
    recipe: values["recipe"],
    mappingRules: values["mappingRules"],
    dashboardSpec: values["dashboardSpec"],
    materiality: row.materiality,
    sourceFingerprints: row.source_fingerprints,
  };
  return { parts, plain };
}

export async function latestBlueprint(
  pool: Pool,
  wrapper: KeyWrapper,
  input: { accountId: string; companyId: string },
): Promise<{ version: number; parts: BlueprintParts } | null> {
  return withTransaction(pool, async (tx) => {
    const r = await tx.query<BlueprintRow>(
      `select version, template_spec, recipe, mapping_rules, dashboard_spec, materiality, source_fingerprints, prev_hash, hash
       from public.blueprints where company_id = $1 and account_id = $2 order by version desc limit 1`,
      [input.companyId, input.accountId],
    );
    const row = r.rows[0];
    if (row === undefined) return null;
    const dek = await companyDek(tx, wrapper, input.accountId, input.companyId);
    try {
      return {
        version: row.version,
        parts: openBlueprint(dek, row, input.accountId, input.companyId).parts,
      };
    } finally {
      dek.fill(0);
    }
  });
}

/** Recomputes the company's blueprint chain from decrypted parts. */
export async function verifyBlueprintChain(
  pool: Pool,
  wrapper: KeyWrapper,
  input: { accountId: string; companyId: string },
): Promise<{ ok: true; checked: number } | { ok: false; version: number }> {
  return withTransaction(pool, async (tx) => {
    const r = await tx.query<BlueprintRow>(
      `select version, template_spec, recipe, mapping_rules, dashboard_spec, materiality, source_fingerprints, prev_hash, hash
       from public.blueprints where company_id = $1 and account_id = $2 order by version`,
      [input.companyId, input.accountId],
    );
    if (r.rows.length === 0) return { ok: true, checked: 0 };
    const dek = await companyDek(tx, wrapper, input.accountId, input.companyId);
    try {
      let prev = GENESIS_HASH;
      for (const row of r.rows) {
        const { parts, plain } = openBlueprint(
          dek,
          row,
          input.accountId,
          input.companyId,
        );
        const expected = computeHash(
          prev,
          chainPayload(input.companyId, row.version, plain, parts),
        );
        if (row.prev_hash !== prev || row.hash !== expected)
          return { ok: false, version: row.version };
        prev = row.hash;
      }
      return { ok: true, checked: r.rows.length };
    } finally {
      dek.fill(0);
    }
  });
}

// ---------------------------------------------------------------------------
// General company-scoped sealing (stage checkpoints, output files)
// ---------------------------------------------------------------------------

/** Encrypts bytes under the company's data key, bound to a purpose and an id. */
export async function sealForCompany(
  pool: Pool,
  wrapper: KeyWrapper,
  input: {
    accountId: string;
    companyId: string;
    purpose: string;
    id: string;
    plaintext: Buffer;
  },
): Promise<Buffer> {
  return withTransaction(pool, async (tx) => {
    const dek = await companyDek(tx, wrapper, input.accountId, input.companyId);
    try {
      return encryptWithKey(dek, input.plaintext, {
        purpose: input.purpose,
        account_id: input.accountId,
        company_id: input.companyId,
        id: input.id,
      });
    } finally {
      dek.fill(0);
    }
  });
}

export async function openForCompany(
  pool: Pool,
  wrapper: KeyWrapper,
  input: {
    accountId: string;
    companyId: string;
    purpose: string;
    id: string;
    sealed: Uint8Array;
  },
): Promise<Buffer> {
  return withTransaction(pool, async (tx) => {
    const dek = await companyDek(tx, wrapper, input.accountId, input.companyId);
    try {
      return decryptWithKey(dek, input.sealed, {
        purpose: input.purpose,
        account_id: input.accountId,
        company_id: input.companyId,
        id: input.id,
      });
    } finally {
      dek.fill(0);
    }
  });
}

/** SPEC §10 purge: destroy the wrapped data key; every sealed value becomes unreadable. */
export async function shredCompanyKey(
  db: Queryable,
  companyId: string,
  now: Date,
): Promise<void> {
  await db.query(
    `update public.company_keys set wrapped_dek = null, destroyed_at = $2 where company_id = $1 and destroyed_at is null`,
    [companyId, now],
  );
}

// ---------------------------------------------------------------------------
// Account-scoped sealing ("apply to all my companies" rules, SPEC §18)
// ---------------------------------------------------------------------------

const accountKeyContext = (accountId: string): EncryptionContext => ({
  purpose: "account_dek",
  account_id: accountId,
});

async function accountDek(
  db: Queryable,
  wrapper: KeyWrapper,
  accountId: string,
): Promise<Buffer> {
  const r = await db.query<{ wrapped_dek: Buffer; kms_key_version: string }>(
    `select wrapped_dek, kms_key_version from public.account_keys where account_id = $1 for update`,
    [accountId],
  );
  const row = r.rows[0];
  if (row !== undefined) {
    return wrapper.unwrap(
      { ciphertext: row.wrapped_dek, keyVersion: row.kms_key_version },
      accountKeyContext(accountId),
    );
  }
  const { plaintext, wrapped } = await wrapper.generateDataKey(
    accountKeyContext(accountId),
  );
  await db.query(
    `insert into public.account_keys (account_id, wrapped_dek, kms_key_version) values ($1, $2, $3)`,
    [accountId, Buffer.from(wrapped.ciphertext), wrapped.keyVersion],
  );
  return plaintext;
}

export interface StoredAccountRule {
  readonly pattern: string;
  readonly head: string;
}

/** Adds account rules, replacing any earlier rule for the same pattern. */
export async function saveAccountRules(
  pool: Pool,
  wrapper: KeyWrapper,
  input: {
    accountId: string;
    companyId: string | null;
    rules: readonly StoredAccountRule[];
    now?: Date;
  },
): Promise<number> {
  if (input.rules.length === 0) return 0;
  const existing = await loadAccountRules(pool, wrapper, input.accountId);
  const replace = new Set(input.rules.map((r) => r.pattern));
  return withTransaction(pool, async (tx) => {
    const dek = await accountDek(tx, wrapper, input.accountId);
    try {
      for (const e of existing.filter((x) => replace.has(x.pattern))) {
        await tx.query(
          `update public.account_mapping_rules set deleted_at = $2 where id = $1`,
          [e.id, input.now ?? new Date()],
        );
      }
      for (const rule of input.rules) {
        const id = await tx.query<{ id: string }>(`select gen_random_uuid() as id`);
        const ruleId = id.rows[0]?.id ?? "";
        const sealed = encryptWithKey(dek, Buffer.from(rule.pattern), {
          purpose: "account_rule",
          account_id: input.accountId,
          id: ruleId,
        });
        await tx.query(
          `insert into public.account_mapping_rules (id, account_id, normalized_pattern, mis_head_id, created_from_company_id)
           values ($1, $2, $3, (select id from public.mis_heads where code = $4), $5)`,
          [ruleId, input.accountId, sealed, rule.head, input.companyId],
        );
      }
      return input.rules.length;
    } finally {
      dek.fill(0);
    }
  });
}

export async function loadAccountRules(
  pool: Pool,
  wrapper: KeyWrapper,
  accountId: string,
): Promise<(StoredAccountRule & { id: string })[]> {
  const r = await pool.query<{ id: string; normalized_pattern: Buffer; code: string }>(
    `select r.id, r.normalized_pattern, h.code from public.account_mapping_rules r
     join public.mis_heads h on h.id = r.mis_head_id
     where r.account_id = $1 and r.deleted_at is null order by r.created_at`,
    [accountId],
  );
  if (r.rows.length === 0) return [];
  return withTransaction(pool, async (tx) => {
    const dek = await accountDek(tx, wrapper, accountId);
    try {
      return r.rows.map((row) => ({
        id: row.id,
        head: row.code,
        pattern: decryptWithKey(dek, row.normalized_pattern, {
          purpose: "account_rule",
          account_id: accountId,
          id: row.id,
        }).toString("utf8"),
      }));
    } finally {
      dek.fill(0);
    }
  });
}
