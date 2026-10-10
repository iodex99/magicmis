/**
 * A company's board shared by a link (ADR 0090).
 *
 * The board is frozen when the link is made — what its owner looked at is what the reader sees —
 * and sealed under the company's own key, so deleting the company destroys every copy it shared.
 * The link carries a secret of 32 random bytes; only its SHA-256 is stored, so the link is shown
 * once and a database read cannot rebuild it. Opening one writes the opening down first, then
 * decrypts, the order every file read follows (ADR 0047). Nothing here is charged: a share shows
 * figures and words the owner already paid for, and asks nothing new of the engine or the model.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { KeyWrapper } from "@magicmis/crypto";
import { readConfig } from "@magicmis/db/config";
import { openForCompany, sealForCompany } from "@magicmis/engine/server";
import type { Pool } from "pg";
import { z } from "zod";

import { queueNotification } from "./notify";

const PURPOSE = "share_snapshot";
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/u;
/** 32 bytes, base64url without padding. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/u;

export class ShareError extends Error {
  constructor(
    readonly code: "not_found" | "bad_period" | "bad_days" | "too_many",
    message: string,
  ) {
    super(message);
    this.name = "ShareError";
  }
}

const hashOf = (token: string): Buffer => createHash("sha256").update(token).digest();

/** How long a link may last: the default offered and the longest allowed (config, SPEC §0.5). */
export async function shareLimits(
  pool: Pool,
): Promise<{ defaultDays: number; maxDays: number }> {
  const days = z.number().int().min(1).max(3650);
  const [defaultDays, maxDays] = await Promise.all([
    readConfig(pool, "share.default_days", days),
    readConfig(pool, "share.max_days", days),
  ]);
  return { defaultDays, maxDays };
}

/**
 * Makes a link to a frozen board. `board` is whatever the page needs to draw it — the caller
 * builds it from the company's own figures — and is sealed as it is given. Returns the secret
 * once; it is not kept.
 */
export async function createShare(
  pool: Pool,
  wrapper: KeyWrapper,
  scope: { accountId: string; companyId: string },
  input: {
    period: string;
    withWriting: boolean;
    days: number;
    board: unknown;
    now?: Date;
  },
): Promise<{ id: string; token: string; expiresAt: Date }> {
  if (!MONTH.test(input.period))
    throw new ShareError("bad_period", "Choose a month the board shows.");
  const { maxDays } = await shareLimits(pool);
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > maxDays)
    throw new ShareError(
      "bad_days",
      `A link can last from one day to ${maxDays.toString()} days.`,
    );
  const owned = await pool.query<{ name: string }>(
    `select name from public.companies
      where id = $1 and account_id = $2 and deleted_at is null and purged_at is null`,
    [scope.companyId, scope.accountId],
  );
  const company = owned.rows[0];
  if (company === undefined) throw new ShareError("not_found", "Company not found.");
  // Each link is a sealed copy of the whole board, made at no charge: a company has only so many
  // live at once (ADR 0091).
  const now = input.now ?? new Date();
  const [cap, live] = await Promise.all([
    readConfig(pool, "share.max_active_links", z.number().int().positive()),
    pool.query<{ n: number }>(
      `select count(*)::int as n from public.share_links
        where company_id = $1 and account_id = $2 and revoked_at is null and expires_at > $3`,
      [scope.companyId, scope.accountId, now],
    ),
  ]);
  if ((live.rows[0]?.n ?? 0) >= cap)
    throw new ShareError(
      "too_many",
      `This company already has ${cap.toString()} links that still work. Withdraw one on Files and settings to make another.`,
    );

  const id = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + input.days * 86_400_000);
  const sealed = await sealForCompany(pool, wrapper, {
    ...scope,
    purpose: PURPOSE,
    id,
    plaintext: Buffer.from(JSON.stringify(input.board), "utf8"),
  });
  await pool.query(
    `insert into public.share_links
       (id, account_id, company_id, token_hash, period, with_writing, sealed_board,
        created_at, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      scope.accountId,
      scope.companyId,
      hashOf(token),
      input.period,
      input.withWriting,
      sealed,
      now,
      expiresAt,
    ],
  );
  // The owner is told of every link (ADR 0091), by email and in the inbox: a link made at an
  // unattended desk outlives the session that made it.
  const [year, month] = input.period.split("-");
  await queueNotification(pool, {
    accountId: scope.accountId,
    type: "security.share_created",
    payload: {
      company_id: scope.companyId,
      company_name: company.name,
      month: `${MONTHS[Number.parseInt(month ?? "", 10) - 1] ?? ""} ${year ?? ""}`,
      expires_at: expiresAt.toISOString(),
    },
    dedupeKey: `share:${id}`,
  });
  return { id, token, expiresAt };
}

export interface ShareSummary {
  readonly id: string;
  readonly period: string;
  readonly withWriting: boolean;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly views: number;
  readonly lastViewedAt: Date | null;
}

/** A company's links, newest first, with how often and when each was last opened. */
export async function listShares(
  pool: Pool,
  scope: { accountId: string; companyId: string },
): Promise<ShareSummary[]> {
  const r = await pool.query<{
    id: string;
    period: string;
    with_writing: boolean;
    created_at: Date;
    expires_at: Date;
    revoked_at: Date | null;
    views: number;
    last_viewed_at: Date | null;
  }>(
    `select s.id, s.period, s.with_writing, s.created_at, s.expires_at, s.revoked_at,
            count(v.id)::int as views, max(v.viewed_at) as last_viewed_at
       from public.share_links s
       left join public.share_link_views v on v.share_id = s.id
      where s.account_id = $1 and s.company_id = $2
      group by s.id
      order by s.created_at desc`,
    [scope.accountId, scope.companyId],
  );
  return r.rows.map((s) => ({
    id: s.id,
    period: s.period,
    withWriting: s.with_writing,
    createdAt: s.created_at,
    expiresAt: s.expires_at,
    revokedAt: s.revoked_at,
    views: s.views,
    lastViewedAt: s.last_viewed_at,
  }));
}

/** Withdraws a link at once. Withdrawing one already withdrawn changes nothing. */
export async function revokeShare(
  pool: Pool,
  scope: { accountId: string; companyId: string },
  shareId: string,
): Promise<void> {
  const r = await pool.query(
    `update public.share_links set revoked_at = coalesce(revoked_at, now())
      where id = $1 and account_id = $2 and company_id = $3`,
    [shareId, scope.accountId, scope.companyId],
  );
  if (r.rowCount === 0) throw new ShareError("not_found", "Link not found.");
}

/**
 * Worker: deletes links that expired or were withdrawn more than `share.retention_days` ago, and
 * with them their sealed boards and their openings (ADR 0091). Until then the owner still sees
 * that a link existed and how often it was opened.
 */
export async function purgeOldShares(
  pool: Pool,
  now: Date = new Date(),
): Promise<number> {
  const days = await readConfig(
    pool,
    "share.retention_days",
    z.number().int().positive(),
  );
  const r = await pool.query(
    `delete from public.share_links
      where coalesce(revoked_at, expires_at) < $1 and (revoked_at is not null or expires_at < $2)`,
    [new Date(now.getTime() - days * 86_400_000), now],
  );
  return r.rowCount ?? 0;
}

export interface OpenedShare {
  readonly id: string;
  readonly companyName: string;
  readonly period: string;
  readonly withWriting: boolean;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly board: unknown;
}

/**
 * Opens a link for whoever holds it, or null — for a secret that is malformed, unknown, expired
 * or withdrawn, or a company deleted or an account suspended since — with no hint which. The opening is recorded before
 * the board is decrypted.
 */
export async function openShare(
  pool: Pool,
  wrapper: KeyWrapper,
  token: string,
  now: Date = new Date(),
): Promise<OpenedShare | null> {
  if (!TOKEN.test(token)) return null;
  const r = await pool.query<{
    id: string;
    account_id: string;
    company_id: string;
    company_name: string;
    period: string;
    with_writing: boolean;
    sealed_board: Buffer;
    created_at: Date;
    expires_at: Date;
  }>(
    `select s.id, s.account_id, s.company_id, c.name as company_name, s.period, s.with_writing,
            s.sealed_board, s.created_at, s.expires_at
       from public.share_links s
       join public.companies c on c.id = s.company_id and c.account_id = s.account_id
       join public.accounts a on a.id = s.account_id
      where s.token_hash = $1 and s.revoked_at is null and s.expires_at > $2
        and c.deleted_at is null and c.purged_at is null
        -- A suspended or closed account's links stop with its sessions (ADR 0091).
        and a.status = 'active'`,
    [hashOf(token), now],
  );
  const s = r.rows[0];
  if (s === undefined) return null;
  await pool.query(
    `insert into public.share_link_views (share_id, account_id, viewed_at) values ($1, $2, $3)`,
    [s.id, s.account_id, now],
  );
  const plain = await openForCompany(pool, wrapper, {
    accountId: s.account_id,
    companyId: s.company_id,
    purpose: PURPOSE,
    id: s.id,
    sealed: s.sealed_board,
  });
  return {
    id: s.id,
    companyName: s.company_name,
    period: s.period,
    withWriting: s.with_writing,
    createdAt: s.created_at,
    expiresAt: s.expires_at,
    board: JSON.parse(plain.toString("utf8")) as unknown,
  };
}
