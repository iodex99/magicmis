import "server-only";

import { randomUUID } from "node:crypto";

import type { KeyWrapper } from "@magicmis/crypto";
import { openForAccount, sealForAccount } from "@magicmis/engine/server";
import type { Pool } from "pg";

import type { WorkbookBrand, WorkbookImage } from "@magicmis/render-excel";

import { checkLogo, type LogoType } from "@/lib/logo";
import { readCompanyLogo } from "@/lib/server/logo";

/**
 * The preparer's own name and mark (ADR 0087): the account's business name and an optional logo,
 * shown beside the company's in Present and on the workbook's cover — only once the account has
 * turned it on, because an owner presenting their own business is not its preparer.
 *
 * The logo is sealed under the account's data key, like a data export, so erasing the account
 * leaves it unreadable.
 */

/** Bound into the seal, so the ciphertext cannot be opened as anything else. */
const PURPOSE = "account.brand_logo";

export interface Brand {
  readonly on: boolean;
  readonly name: string;
  readonly logoVersion: string | null;
}

export async function readBrand(pool: Pool, accountId: string): Promise<Brand | null> {
  const r = await pool.query<{
    brand_on: boolean;
    business_name: string;
    brand_logo_version: string | null;
  }>(
    `select brand_on, business_name, brand_logo_version from public.accounts
      where id = $1 and purged_at is null`,
    [accountId],
  );
  const row = r.rows[0];
  return row === undefined
    ? null
    : { on: row.brand_on, name: row.business_name, logoVersion: row.brand_logo_version };
}

export async function setBrandOn(
  pool: Pool,
  accountId: string,
  on: boolean,
): Promise<void> {
  await pool.query(`update public.accounts set brand_on = $2 where id = $1`, [
    accountId,
    on,
  ]);
}

/** Seals and stores the logo, replacing any earlier one; returns its new version. */
export async function setBrandLogo(
  pool: Pool,
  wrapper: KeyWrapper,
  input: { accountId: string; type: LogoType; bytes: Buffer },
): Promise<string> {
  const version = randomUUID();
  const sealed = await sealForAccount(pool, wrapper, {
    accountId: input.accountId,
    purpose: PURPOSE,
    id: version,
    plaintext: input.bytes,
  });
  await pool.query(
    `update public.accounts
        set brand_logo_sealed = $2, brand_logo_type = $3, brand_logo_version = $4
      where id = $1`,
    [input.accountId, sealed, input.type, version],
  );
  return version;
}

export async function clearBrandLogo(pool: Pool, accountId: string): Promise<void> {
  await pool.query(
    `update public.accounts
        set brand_logo_sealed = null, brand_logo_type = null, brand_logo_version = null
      where id = $1`,
    [accountId],
  );
}

/** The logo's bytes and type, opened under the account's key; null when there is none. */
export async function readBrandLogo(
  pool: Pool,
  wrapper: KeyWrapper,
  accountId: string,
): Promise<{ bytes: Buffer; type: LogoType; version: string } | null> {
  const r = await pool.query<{
    brand_logo_sealed: Buffer | null;
    brand_logo_type: LogoType | null;
    brand_logo_version: string | null;
  }>(
    `select brand_logo_sealed, brand_logo_type, brand_logo_version from public.accounts
      where id = $1 and purged_at is null`,
    [accountId],
  );
  const row = r.rows[0];
  if (
    row?.brand_logo_sealed == null ||
    row.brand_logo_type === null ||
    row.brand_logo_version === null
  )
    return null;
  const bytes = await openForAccount(pool, wrapper, {
    accountId,
    purpose: PURPOSE,
    id: row.brand_logo_version,
    sealed: row.brand_logo_sealed,
  });
  return { bytes, type: row.brand_logo_type, version: row.brand_logo_version };
}

/** The URL the logo is served from, keyed by its version so a replaced one is never stale. */
export const brandLogoUrl = (version: string | null): string | null =>
  version === null ? null : `/api/account/brand/logo?v=${version}`;

/**
 * The cover's marks for a run's workbook (ADR 0087): the company's logo, and the preparer when the
 * account chose to be named. PNG and JPEG only, the formats a workbook can carry; a WebP logo
 * stays on the screen. A logo that cannot be read leaves the cover with names alone — a mark is
 * never a reason for a run to fail.
 */
export async function workbookBrand(
  pool: Pool,
  wrapper: KeyWrapper,
  scope: { accountId: string; companyId: string },
): Promise<WorkbookBrand> {
  const image = (
    logo: { bytes: Buffer; type: LogoType } | null,
  ): WorkbookImage | null => {
    if (logo === null || logo.type === "image/webp") return null;
    const bytes = new Uint8Array(logo.bytes);
    const read = checkLogo(bytes, {
      maxBytes: Number.MAX_SAFE_INTEGER,
      maxSidePx: Number.MAX_SAFE_INTEGER,
    });
    if (!read.ok) return null;
    return {
      bytes,
      extension: logo.type === "image/png" ? "png" : "jpeg",
      width: read.width,
      height: read.height,
    };
  };
  const quietly = <T>(p: Promise<T>) => p.catch(() => null);
  const [companyLogo, brand] = await Promise.all([
    quietly(readCompanyLogo(pool, wrapper, scope)),
    readBrand(pool, scope.accountId),
  ]);
  const preparer =
    brand?.on === true
      ? {
          name: brand.name,
          logo: image(await quietly(readBrandLogo(pool, wrapper, scope.accountId))),
        }
      : null;
  return { companyLogo: image(companyLogo), preparer };
}
