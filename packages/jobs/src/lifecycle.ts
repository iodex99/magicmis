/**
 * Company lifecycle and memory fee (SPEC §28).
 *
 *   active  — first successful setup; fee paid          → fee debit fails → grace
 *   grace   — view, history, buy credits; no jobs/chat  → arrears paid → active;
 *                                                          `lifecycle.grace_months` unpaid → archived
 *   archived — restore only                              → restore price + current fee → active;
 *                                                          `lifecycle.archive_months` → purged
 *   purged  — terminal; the company data key is destroyed (crypto-shredding)
 *
 * The fee is a fixed capture of `company_memory_monthly` on each anchor-date anniversary, once per
 * company-month (`company_fee_charges` is unique on it). Deleting a company stops fees at once and
 * schedules purge after `lifecycle.deletion_purge_delay_days`. Setup includes its first month; the
 * first debit falls one month after the anchor date (ADR 0021, R-36).
 */

import { readConfig } from "@magicmis/db/config";
import { withTransaction, type Queryable } from "@magicmis/db/tx";
import { toIstParts } from "@magicmis/core/time";
import { shredAccountKey, shredCompanyKey } from "@magicmis/engine/server";
import { appendAudit } from "@magicmis/db/audit";
import type { KeyWrapper } from "@magicmis/crypto";
import {
  captureReservation,
  priceFor,
  reserveCredits,
  walletSummary,
} from "@magicmis/wallet";
import type { Pool } from "pg";
import { z } from "zod";

import { removeAccountExports } from "./exports";
import { removeLibraryVotes } from "./library";
import { queueNotification } from "./notify";
import type { OutputStore } from "./settle";

const DAY = 86_400_000;

interface CompanyRow {
  id: string;
  account_id: string;
  name: string;
  lifecycle_state: "active" | "grace" | "archived" | "purged";
  memory_fee_anchor_date: string | null;
  unpaid_months: number;
  archived_at: Date | null;
  purge_after: Date | null;
  deleted_at: Date | null;
  reminder_day_of_month: number;
}

const istToday = (now: Date) => {
  const p = toIstParts(now);
  return { year: p.year, month: p.month, day: p.day };
};

const monthKey = (y: number, m: number) =>
  `${y.toString()}-${m.toString().padStart(2, "0")}`;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The due date (IST calendar date as UTC midnight) of the k-th monthly anniversary of the anchor. */
function dueDate(anchor: string, k: number): Date {
  const [y = 0, m = 1, d = 1] = anchor.split("-").map((x) => Number.parseInt(x, 10));
  const zero = y * 12 + (m - 1) + k;
  const year = Math.floor(zero / 12);
  const month = (zero % 12) + 1;
  return new Date(Date.UTC(year, month - 1, Math.min(d, daysIn(year, month))));
}

/** Months whose fee is due on or before today, after the anchor month itself. */
function dueMonths(anchor: string, now: Date): { key: string; due: Date }[] {
  const t = istToday(now);
  const today = Date.UTC(t.year, t.month - 1, t.day);
  const out: { key: string; due: Date }[] = [];
  for (let k = 1; k < 1200; k += 1) {
    const due = dueDate(anchor, k);
    if (due.getTime() > today) break;
    out.push({ key: monthKey(due.getUTCFullYear(), due.getUTCMonth() + 1), due });
  }
  return out;
}

async function feeCredits(
  db: Queryable,
  action: "company_memory_monthly" | "company_restore",
  now: Date,
): Promise<bigint> {
  return (
    await priceFor(db, {
      actionKey: action,
      tier: "professional",
      delivery: "standard",
      at: now,
    })
  ).credits;
}

/** Reserve and capture a fixed amount for a company in one idempotent step. */
async function chargeCompany(
  pool: Pool,
  company: CompanyRow,
  credits: bigint,
  key: string,
  now: Date,
): Promise<{ ok: true; reservationId: string } | { ok: false }> {
  if (credits === 0n) return { ok: true, reservationId: "" };
  const res = await reserveCredits(pool, {
    accountId: company.account_id,
    amount: credits,
    kind: "realtime",
    subject: { companyId: company.id },
    idempotencyKey: key,
    now,
  });
  if (!res.ok) return { ok: false };
  await captureReservation(pool, {
    reservationId: res.reservationId,
    amount: credits,
    idempotencyKey: `${key}:capture`,
    now,
  });
  return { ok: true, reservationId: res.reservationId };
}

async function companies(
  db: Queryable,
  where: string,
  params: unknown[] = [],
): Promise<CompanyRow[]> {
  const r = await db.query<CompanyRow>(
    `select id, account_id, name, lifecycle_state, memory_fee_anchor_date::text as memory_fee_anchor_date, unpaid_months,
            archived_at, purge_after, deleted_at, reminder_day_of_month
     from public.companies where ${where}`,
    params,
  );
  return r.rows;
}

/**
 * Worker: debit every due memory fee. Active companies that cannot pay enter grace; a grace company
 * pays its arrears in full or accrues another unpaid month; enough unpaid months archive it.
 */
export async function debitMemoryFees(
  pool: Pool,
  now: Date = new Date(),
): Promise<{ charged: number; failed: number; archived: number }> {
  const graceMonths = await readConfig(
    pool,
    "lifecycle.grace_months",
    z.number().int().positive(),
  );
  const archiveMonths = await readConfig(
    pool,
    "lifecycle.archive_months",
    z.number().int().positive(),
  );
  let charged = 0;
  let failed = 0;
  let archived = 0;

  for (const company of await companies(
    pool,
    "deleted_at is null and lifecycle_state in ('active', 'grace') and first_setup_at is not null and memory_fee_anchor_date is not null",
  )) {
    const due = dueMonths(company.memory_fee_anchor_date ?? "", now);
    const settled = await pool.query<{ fee_month: string; status: string }>(
      `select fee_month, status from public.company_fee_charges where company_id = $1 and kind = 'memory_fee'`,
      [company.id],
    );
    const status = new Map(settled.rows.map((r) => [r.fee_month, r.status]));
    const unpaid = due.filter((d) => status.get(d.key) !== "captured");
    if (unpaid.length === 0) continue;

    const fee = await feeCredits(pool, "company_memory_monthly", now);
    const total = fee * BigInt(unpaid.length);
    const latest = unpaid[unpaid.length - 1]?.key ?? "";
    const attempt = await chargeCompany(
      pool,
      company,
      total,
      `memory_fee:${company.id}:${unpaid.map((u) => u.key).join(",")}`,
      now,
    );

    if (attempt.ok) {
      await withTransaction(pool, async (tx) => {
        for (const u of unpaid) {
          await tx.query(
            `insert into public.company_fee_charges (company_id, account_id, fee_month, kind, credits, status, reservation_id, created_at)
             values ($1, $2, $3, 'memory_fee', $4, 'captured', $5, $6)
             on conflict (company_id, fee_month, kind) do update set status = 'captured', credits = excluded.credits, reservation_id = excluded.reservation_id`,
            [
              company.id,
              company.account_id,
              u.key,
              fee.toString(),
              attempt.reservationId === "" ? null : attempt.reservationId,
              now,
            ],
          );
        }
        await tx.query(
          `update public.companies set lifecycle_state = 'active', unpaid_months = 0, grace_started_at = null, memory_fee_paid_through = $2::date where id = $1`,
          [company.id, `${latest}-01`],
        );
        await queueNotification(tx, {
          accountId: company.account_id,
          type: "billing.memory_fee_debited",
          payload: {
            company_id: company.id,
            company_name: company.name,
            months: unpaid.length,
            credits: total.toString(),
          },
          dedupeKey: `memory_fee_debited:${company.id}:${latest}`,
        });
      });
      charged += unpaid.length;
      continue;
    }

    // Could not pay. Record each unpaid month once and count them.
    await withTransaction(pool, async (tx) => {
      for (const u of unpaid) {
        await tx.query(
          `insert into public.company_fee_charges (company_id, account_id, fee_month, kind, credits, status, created_at)
           values ($1, $2, $3, 'memory_fee', $4, 'failed', $5) on conflict (company_id, fee_month, kind) do nothing`,
          [company.id, company.account_id, u.key, fee.toString(), now],
        );
      }
      const months = unpaid.length;
      if (months >= graceMonths) {
        await tx.query(
          `update public.companies set lifecycle_state = 'archived', unpaid_months = $2, archived_at = $3, purge_after = $4 where id = $1`,
          [company.id, months, now, new Date(now.getTime() + archiveMonths * 30 * DAY)],
        );
        await queueNotification(tx, {
          accountId: company.account_id,
          type: "lifecycle.archived",
          payload: { company_id: company.id, company_name: company.name },
          dedupeKey: `archived:${company.id}:${latest}`,
        });
        archived += 1;
      } else {
        await tx.query(
          `update public.companies set lifecycle_state = 'grace', unpaid_months = $2, grace_started_at = coalesce(grace_started_at, $3) where id = $1`,
          [company.id, months, now],
        );
        await queueNotification(tx, {
          accountId: company.account_id,
          type: "billing.memory_fee_failed",
          payload: {
            company_id: company.id,
            company_name: company.name,
            credits: total.toString(),
          },
          dedupeKey: `memory_fee_failed:${company.id}:${latest}`,
        });
        if (company.lifecycle_state === "active") {
          await queueNotification(tx, {
            accountId: company.account_id,
            type: "lifecycle.grace",
            payload: { company_id: company.id, company_name: company.name },
            dedupeKey: `grace:${company.id}:${latest}`,
          });
        }
      }
    });
    failed += 1;
  }
  return { charged, failed, archived };
}

/** Worker: notices ahead of fee dates (low balance), archive and purge (SPEC §28, §29). */
export async function queueLifecycleNotices(
  pool: Pool,
  now: Date = new Date(),
): Promise<number> {
  const lowDays = await readConfig(
    pool,
    "lifecycle.low_balance_notice_days",
    z.array(z.number().int().positive()),
  );
  const archiveDays = await readConfig(
    pool,
    "lifecycle.archive_notice_days",
    z.array(z.number().int().positive()),
  );
  const purgeDays = await readConfig(
    pool,
    "lifecycle.purge_notice_days",
    z.array(z.number().int().positive()),
  );
  const graceMonths = await readConfig(
    pool,
    "lifecycle.grace_months",
    z.number().int().positive(),
  );
  const t = istToday(now);
  const today = Date.UTC(t.year, t.month - 1, t.day);
  let queued = 0;

  for (const c of await companies(
    pool,
    "deleted_at is null and lifecycle_state in ('active','grace') and memory_fee_anchor_date is not null",
  )) {
    const anchor = c.memory_fee_anchor_date ?? "";
    let k = 1;
    while (dueDate(anchor, k).getTime() <= today) k += 1;
    const next = dueDate(anchor, k);
    // Both are UTC midnights, so the difference is a whole number of days.
    const daysAhead = Math.floor((next.getTime() - today) / DAY);
    const nextKey = monthKey(next.getUTCFullYear(), next.getUTCMonth() + 1);
    if (c.lifecycle_state === "active" && lowDays.includes(daysAhead)) {
      const fee = await feeCredits(pool, "company_memory_monthly", now);
      const wallet = await walletSummary(pool, c.account_id, now);
      if (wallet.available < fee) {
        if (
          await queueNotification(pool, {
            accountId: c.account_id,
            type: "billing.low_balance_before_fee",
            payload: {
              company_id: c.id,
              company_name: c.name,
              days: daysAhead,
              credits: fee.toString(),
            },
            dedupeKey: `fee_low_balance:${c.id}:${nextKey}:${daysAhead.toString()}`,
          })
        )
          queued += 1;
      }
    }
    // The next due date archives a grace company that has one month of grace left.
    if (
      c.lifecycle_state === "grace" &&
      c.unpaid_months + 1 >= graceMonths &&
      archiveDays.includes(daysAhead)
    ) {
      if (
        await queueNotification(pool, {
          accountId: c.account_id,
          type: "lifecycle.archive_notice",
          payload: { company_id: c.id, company_name: c.name, days: daysAhead },
          dedupeKey: `archive_notice:${c.id}:${nextKey}:${daysAhead.toString()}`,
        })
      )
        queued += 1;
    }
  }

  for (const c of await companies(
    pool,
    "lifecycle_state <> 'purged' and purge_after is not null",
  )) {
    const daysAhead = Math.ceil(((c.purge_after?.getTime() ?? 0) - now.getTime()) / DAY);
    if (!purgeDays.includes(daysAhead)) continue;
    if (
      await queueNotification(pool, {
        accountId: c.account_id,
        type: "lifecycle.purge_notice",
        payload: { company_id: c.id, company_name: c.name, days: daysAhead },
        dedupeKey: `purge_notice:${c.id}:${daysAhead.toString()}`,
      })
    )
      queued += 1;
  }
  return queued;
}

/** Worker: purge archived or deleted companies whose time has come — destroy the data key. */
export async function purgeCompanies(
  pool: Pool,
  store: OutputStore | null,
  now: Date = new Date(),
): Promise<number> {
  let purged = 0;
  for (const c of await companies(
    pool,
    "lifecycle_state <> 'purged' and purge_after is not null and purge_after <= $1",
    [now],
  )) {
    const outputs = await pool.query<{ storage_path: string }>(
      `select storage_path from public.outputs where company_id = $1`,
      [c.id],
    );
    if (store !== null && outputs.rows.length > 0)
      await store.remove(outputs.rows.map((o) => o.storage_path).filter((p) => p !== ""));
    await withTransaction(pool, async (tx) => {
      await shredCompanyKey(tx, c.id, now);
      await tx.query(`delete from public.outputs where company_id = $1`, [c.id]);
      await tx.query(
        `update public.companies set lifecycle_state = 'purged', purged_at = $2, wrapped_redaction_key = null where id = $1`,
        [c.id, now],
      );
      await queueNotification(tx, {
        accountId: c.account_id,
        type: "lifecycle.purged",
        payload: { company_id: c.id, company_name: c.name },
        dedupeKey: `purged:${c.id}`,
      });
    });
    purged += 1;
  }
  return purged;
}

/** User deletion: fees stop immediately; no pro-rata refund; purge after the configured delay. */
export async function deleteCompany(
  pool: Pool,
  input: { accountId: string; companyId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  const delay = await readConfig(
    pool,
    "lifecycle.deletion_purge_delay_days",
    z.number().int().nonnegative(),
  );
  const r = await pool.query(
    `update public.companies set deleted_at = coalesce(deleted_at, $3), purge_after = coalesce(purge_after, $4)
     where id = $1 and account_id = $2 and lifecycle_state <> 'purged'`,
    [input.companyId, input.accountId, now, new Date(now.getTime() + delay * DAY)],
  );
  if (r.rowCount !== 1) throw new Error("company not found");
}

export type RestoreResult =
  | { readonly status: "restored"; readonly credits: bigint }
  | { readonly status: "insufficient_credits"; readonly credits: bigint }
  | { readonly status: "not_archived" };

/** Restore an archived company: `company_restore` price plus the current month's fee (SPEC §28). */
export async function restoreCompany(
  pool: Pool,
  input: { accountId: string; companyId: string; now?: Date },
): Promise<RestoreResult> {
  const now = input.now ?? new Date();
  const [company] = await companies(
    pool,
    "id = $1 and account_id = $2 and deleted_at is null",
    [input.companyId, input.accountId],
  );
  if (company?.lifecycle_state !== "archived") return { status: "not_archived" };
  const t = istToday(now);
  const month = monthKey(t.year, t.month);
  const credits =
    (await feeCredits(pool, "company_restore", now)) +
    (await feeCredits(pool, "company_memory_monthly", now));
  const attempt = await chargeCompany(
    pool,
    company,
    credits,
    `restore:${company.id}:${month}`,
    now,
  );
  if (!attempt.ok) return { status: "insufficient_credits", credits };
  await withTransaction(pool, async (tx) => {
    await tx.query(
      `insert into public.company_fee_charges (company_id, account_id, fee_month, kind, credits, status, reservation_id, created_at)
       values ($1, $2, $3, 'restore', $4, 'captured', $5, $6) on conflict (company_id, fee_month, kind) do nothing`,
      [
        company.id,
        company.account_id,
        month,
        credits.toString(),
        attempt.reservationId === "" ? null : attempt.reservationId,
        now,
      ],
    );
    // A restored company starts a new fee cycle today; archived months are not charged.
    await tx.query(
      `update public.companies set lifecycle_state = 'active', unpaid_months = 0, archived_at = null, grace_started_at = null,
         purge_after = null, memory_fee_anchor_date = $2::date, memory_fee_paid_through = $2::date
       where id = $1`,
      [company.id, `${month}-${t.day.toString().padStart(2, "0")}`],
    );
    await tx.query(
      `delete from public.company_fee_charges where company_id = $1 and kind = 'memory_fee' and status = 'failed'`,
      [company.id],
    );
  });
  return { status: "restored", credits };
}

/** Worker: the monthly refresh reminder on each company's `reminder_day_of_month` (SPEC §29). */
export async function queueRefreshReminders(
  pool: Pool,
  now: Date = new Date(),
): Promise<number> {
  const t = istToday(now);
  let queued = 0;
  for (const c of await companies(
    pool,
    "deleted_at is null and lifecycle_state = 'active' and first_setup_at is not null and reminder_day_of_month = $1",
    [t.day],
  )) {
    if (
      await queueNotification(pool, {
        accountId: c.account_id,
        type: "reminder.monthly_refresh",
        payload: { company_id: c.id, company_name: c.name },
        dedupeKey: `refresh_reminder:${c.id}:${monthKey(t.year, t.month)}`,
      })
    )
      queued += 1;
  }
  return queued;
}

/**
 * Account erasure (SPEC §10, §31). The account closes now: status `deleted`, every company deleted
 * (fees stop), holds released by the sweepers, and purge scheduled after the configured delay.
 * Invoices and the credit ledger are statutory records and are kept.
 */
export async function deleteAccount(
  pool: Pool,
  input: { accountId: string; now?: Date },
): Promise<{ purgeAfter: Date }> {
  const now = input.now ?? new Date();
  const delay = await readConfig(
    pool,
    "lifecycle.deletion_purge_delay_days",
    z.number().int().nonnegative(),
  );
  const purgeAfter = new Date(now.getTime() + delay * DAY);
  await withTransaction(pool, async (tx) => {
    const r = await tx.query(
      `update public.accounts set status = 'deleted', deleted_at = coalesce(deleted_at, $2),
         purge_after = coalesce(purge_after, $3), active_session_id = null
       where id = $1 and purged_at is null`,
      [input.accountId, now, purgeAfter],
    );
    if (r.rowCount !== 1) throw new Error("account not found");
    await tx.query(
      `update public.companies set deleted_at = coalesce(deleted_at, $2), purge_after = least(coalesce(purge_after, $3), $3)
       where account_id = $1 and lifecycle_state <> 'purged'`,
      [input.accountId, now, purgeAfter],
    );
    await appendAudit(tx, {
      actorType: "account",
      actorId: input.accountId,
      action: "account.deletion_requested",
      targetType: "account",
      targetId: input.accountId,
      metadata: { purgeAfter: purgeAfter.toISOString() },
    });
    await queueNotification(tx, {
      accountId: input.accountId,
      type: "account.deletion_scheduled",
      payload: { purge_after: purgeAfter.toISOString() },
      dedupeKey: `account-deletion:${input.accountId}`,
    });
  });
  return { purgeAfter };
}

/**
 * Worker: purge erased accounts whose delay has passed. Their companies are purged (keys destroyed,
 * outputs removed), the account key is destroyed, and personal fields are overwritten. Rows needed
 * for invoices and the ledger remain, keyed by an account that no longer identifies anyone.
 */
export async function purgeAccounts(
  pool: Pool,
  store: OutputStore | null,
  now: Date = new Date(),
  /** Removes the account library votes; without it they stay, counted by digest only. */
  wrapper: KeyWrapper | null = null,
): Promise<number> {
  const due = await pool.query<{ id: string }>(
    `select id from public.accounts where status = 'deleted' and purged_at is null and purge_after is not null and purge_after <= $1`,
    [now],
  );
  for (const a of due.rows) {
    await pool.query(
      `update public.companies set purge_after = least(coalesce(purge_after, $2), $2) where account_id = $1 and lifecycle_state <> 'purged'`,
      [a.id, now],
    );
    await purgeCompanies(pool, store, now);
    await removeAccountExports(pool, store, a.id);
    if (wrapper !== null) await removeLibraryVotes(pool, wrapper, a.id);
    await withTransaction(pool, async (tx) => {
      await shredAccountKey(tx, a.id, now);
      await tx.query(
        `update public.account_mapping_rules set deleted_at = coalesce(deleted_at, $2) where account_id = $1`,
        [a.id, now],
      );
      await tx.query(
        `update public.accounts set email = 'purged-' || id::text || '@invalid', business_name = 'Deleted account',
           billing_address = '{}'::jsonb, purged_at = $2 where id = $1`,
        [a.id, now],
      );
      await tx.query(`delete from public.login_events where account_id = $1`, [a.id]);
      await appendAudit(tx, {
        actorType: "system",
        actorId: null,
        action: "account.purged",
        targetType: "account",
        targetId: a.id,
        metadata: {},
      });
    });
  }
  return due.rows.length;
}
