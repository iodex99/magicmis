import { randomUUID } from "node:crypto";

import { readConfig } from "@magicmis/db/config";
import { openForCompany, sealForCompany } from "@magicmis/engine/server";
import type { KeyWrapper } from "@magicmis/crypto";
import type { Pool } from "pg";
import { z } from "zod";

import type { LogoLimits, LogoType } from "@/lib/logo";

/** Bound into the seal, so a logo's ciphertext cannot be opened as anything else. */
const PURPOSE = "company.logo";

export async function logoLimits(pool: Pool): Promise<LogoLimits> {
  const [maxBytes, maxSidePx] = await Promise.all([
    readConfig(pool, "companies.logo_max_bytes", z.number().int().positive()),
    readConfig(pool, "companies.logo_max_side_px", z.number().int().positive()),
  ]);
  return { maxBytes, maxSidePx };
}

/** The current logo's version, or null; the URL is built from it. */
export async function logoVersion(
  pool: Pool,
  scope: { accountId: string; companyId: string },
): Promise<string | null> {
  const r = await pool.query<{ logo_version: string | null }>(
    `select logo_version from public.companies
      where id = $1 and account_id = $2 and deleted_at is null`,
    [scope.companyId, scope.accountId],
  );
  return r.rows[0]?.logo_version ?? null;
}

/**
 * Seals the logo under the company's data key and stores it, replacing any earlier one. Returns
 * the new version, or null when the company is not this account's (or is deleted).
 */
export async function setCompanyLogo(
  pool: Pool,
  wrapper: KeyWrapper,
  input: { accountId: string; companyId: string; type: LogoType; bytes: Buffer },
): Promise<string | null> {
  const owned = await pool.query(
    `select 1 from public.companies where id = $1 and account_id = $2 and deleted_at is null`,
    [input.companyId, input.accountId],
  );
  if (owned.rowCount === 0) return null;
  const version = randomUUID();
  const sealed = await sealForCompany(pool, wrapper, {
    accountId: input.accountId,
    companyId: input.companyId,
    purpose: PURPOSE,
    id: version,
    plaintext: input.bytes,
  });
  const r = await pool.query(
    `update public.companies
        set logo_sealed = $3, logo_type = $4, logo_version = $5
      where id = $1 and account_id = $2 and deleted_at is null`,
    [input.companyId, input.accountId, sealed, input.type, version],
  );
  return (r.rowCount ?? 0) > 0 ? version : null;
}

/** Takes the logo off. True when there was a company to take it off. */
export async function clearCompanyLogo(
  pool: Pool,
  scope: { accountId: string; companyId: string },
): Promise<boolean> {
  const r = await pool.query(
    `update public.companies set logo_sealed = null, logo_type = null, logo_version = null
      where id = $1 and account_id = $2 and deleted_at is null`,
    [scope.companyId, scope.accountId],
  );
  return (r.rowCount ?? 0) > 0;
}

/** The logo's bytes and type, opened under the company's key; null when there is none. */
export async function readCompanyLogo(
  pool: Pool,
  wrapper: KeyWrapper,
  scope: { accountId: string; companyId: string },
): Promise<{ bytes: Buffer; type: LogoType; version: string } | null> {
  const r = await pool.query<{
    logo_sealed: Buffer | null;
    logo_type: LogoType | null;
    logo_version: string | null;
  }>(
    `select logo_sealed, logo_type, logo_version from public.companies
      where id = $1 and account_id = $2 and deleted_at is null`,
    [scope.companyId, scope.accountId],
  );
  const row = r.rows[0];
  if (row?.logo_sealed == null || row.logo_type === null || row.logo_version === null)
    return null;
  const bytes = await openForCompany(pool, wrapper, {
    ...scope,
    purpose: PURPOSE,
    id: row.logo_version,
    sealed: row.logo_sealed,
  });
  return { bytes, type: row.logo_type, version: row.logo_version };
}
