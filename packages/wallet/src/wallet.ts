/**
 * Credit wallet operations (SPEC §11).
 *
 * Invariants, enforced here and by CHECK constraints (migration 0006):
 *   balance = Σ credits_remaining over unexpired lots
 *   held    = Σ amount over held reservations
 *   0 ≤ held ≤ balance
 *
 * Every operation:
 *   1. runs in one transaction that locks the account's `wallets` row FOR UPDATE;
 *   2. expires the account's due lots first, so the invariants hold at every operation and
 *      not only after the nightly sweep;
 *   3. writes hash-chained ledger rows carrying balance_after and held_after;
 *   4. is idempotent on its key: a repeat returns the first outcome and changes nothing.
 */

import { appendAudit } from "@magicmis/db/audit";
import { readConfig } from "@magicmis/db/config";
import { withTransaction, type Queryable } from "@magicmis/db/tx";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";

import { appendLedger, type WalletState } from "./ledger";

export type LotSource = "purchase" | "bonus" | "admin_grant" | "goodwill";
export type ReservationKind = "realtime" | "review" | "batch" | "chat";
export type ReservationSubject =
  | { readonly jobId: string }
  | { readonly chatMessageId: string }
  /** SPEC §28: the monthly memory fee and restore, which have no job. */
  | { readonly companyId: string };

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ttlSchema = z.object({
  realtime: z.number().int().positive(),
  review: z.number().int().positive(),
  batch: z.number().int().positive(),
  chat: z.number().int().positive(),
});

async function lotValidityMonths(db: Queryable): Promise<number> {
  return readConfig(db, "wallet.lot_validity_months", z.number().int().min(1).max(120));
}

/** Calendar-month arithmetic in UTC: 31 January + 1 month is the last day of February. */
export function addCalendarMonthsUtc(date: Date, months: number): Date {
  const target = new Date(date.getTime());
  const day = target.getUTCDate();
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

// ---------------------------------------------------------------------------
// Internal helpers (all require the wallet row lock)
// ---------------------------------------------------------------------------

async function lockWallet(tx: PoolClient, accountId: string): Promise<WalletState> {
  await tx.query(
    `insert into public.wallets (account_id) values ($1) on conflict do nothing`,
    [accountId],
  );
  const row = await tx.query<{ balance_credits: string; held_credits: string }>(
    `select balance_credits, held_credits from public.wallets where account_id = $1 for update`,
    [accountId],
  );
  const r = row.rows[0];
  if (r === undefined) throw new Error(`lockWallet: no wallet for account ${accountId}`);
  return { balance: BigInt(r.balance_credits), held: BigInt(r.held_credits) };
}

async function saveWallet(
  tx: PoolClient,
  accountId: string,
  state: WalletState,
): Promise<void> {
  await tx.query(
    `update public.wallets set balance_credits = $2, held_credits = $3, updated_at = now()
     where account_id = $1`,
    [accountId, state.balance.toString(), state.held.toString()],
  );
}

async function keyAlreadyApplied(
  tx: Queryable,
  idempotencyKey: string,
): Promise<boolean> {
  const r = await tx.query(
    `select 1 from public.credit_ledger where idempotency_key = $1`,
    [idempotencyKey],
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * Shrink held reservations, newest first, until held ≤ `coverable`. Writes one release
 * ledger row per shrunk hold. Balance is unchanged here, so every row it writes already
 * satisfies held ≤ balance.
 */
async function shrinkHoldsTo(
  tx: PoolClient,
  accountId: string,
  state: WalletState,
  coverable: bigint,
  now: Date,
): Promise<WalletState> {
  let current = state;
  let shortfall = current.held - coverable;
  if (shortfall <= 0n) return current;

  // Newest holds first: the oldest work has been running longest and is closest to done.
  const holds = await tx.query<{ id: string; amount: string; job_id: string | null }>(
    `select id, amount, job_id from public.reservations
     where account_id = $1 and status = 'held'
     order by created_at desc
     for update`,
    [accountId],
  );
  for (const hold of holds.rows) {
    if (shortfall === 0n) break;
    const amount = BigInt(hold.amount);
    const cut = shortfall < amount ? shortfall : amount;
    const remaining = amount - cut;
    if (remaining === 0n) {
      await tx.query(
        `update public.reservations set status = 'released', settled_at = $2 where id = $1`,
        [hold.id, now],
      );
    } else {
      await tx.query(`update public.reservations set amount = $2 where id = $1`, [
        hold.id,
        remaining.toString(),
      ]);
    }
    current = { balance: current.balance, held: current.held - cut };
    shortfall -= cut;
    await appendLedger(tx, {
      accountId,
      entryType: "release",
      amount: cut,
      reservationId: hold.id,
      jobId: hold.job_id,
      balanceAfter: current.balance,
      heldAfter: current.held,
      idempotencyKey: `expiry-cover:${hold.id}:${amount.toString()}`,
    });
  }
  return current;
}

/**
 * Expire every due lot for the account (SPEC §11.5: "the expiry still applies and the
 * job's capture is limited").
 *
 * For each lot, holds the lot was backing are shrunk BEFORE the expire row is written.
 * The ledger's own CHECK constraint requires held ≤ balance on every row, so the order is
 * not cosmetic: expiring first and covering afterwards writes an invalid row, which the
 * database refuses (found by the time-travel tests).
 */
async function expireDueLots(
  tx: PoolClient,
  accountId: string,
  state: WalletState,
  now: Date,
): Promise<WalletState> {
  let current = state;
  const due = await tx.query<{ id: string; credits_remaining: string }>(
    `select id, credits_remaining from public.credit_lots
     where account_id = $1 and credits_remaining > 0 and expires_at <= $2
     order by expires_at, created_at
     for update`,
    [accountId, now],
  );

  for (const lot of due.rows) {
    const remaining = BigInt(lot.credits_remaining);
    const balanceAfterExpiry = current.balance - remaining;
    current = await shrinkHoldsTo(tx, accountId, current, balanceAfterExpiry, now);

    await tx.query(`update public.credit_lots set credits_remaining = 0 where id = $1`, [
      lot.id,
    ]);
    current = { balance: balanceAfterExpiry, held: current.held };
    await appendLedger(tx, {
      accountId,
      entryType: "expire",
      amount: remaining,
      lotId: lot.id,
      balanceAfter: current.balance,
      heldAfter: current.held,
      idempotencyKey: `expire:lot:${lot.id}`,
    });
  }

  return current;
}

/** Take `amount` from unexpired lots, earliest expiry first. Returns per-lot takes. */
async function consumeLotsFifo(
  tx: PoolClient,
  accountId: string,
  amount: bigint,
  now: Date,
): Promise<{ lotId: string; taken: bigint }[]> {
  const lots = await tx.query<{ id: string; credits_remaining: string }>(
    `select id, credits_remaining from public.credit_lots
     where account_id = $1 and credits_remaining > 0 and expires_at > $2
     order by expires_at, created_at
     for update`,
    [accountId, now],
  );
  let needed = amount;
  const takes: { lotId: string; taken: bigint }[] = [];
  for (const lot of lots.rows) {
    if (needed === 0n) break;
    const remaining = BigInt(lot.credits_remaining);
    const taken = remaining < needed ? remaining : needed;
    await tx.query(
      `update public.credit_lots set credits_remaining = credits_remaining - $2 where id = $1`,
      [lot.id, taken.toString()],
    );
    takes.push({ lotId: lot.id, taken });
    needed -= taken;
  }
  if (needed !== 0n) {
    // Unreachable while the invariants hold: balance = Σ unexpired lots ≥ held ≥ amount.
    throw new Error(`consumeLotsFifo: lots short by ${needed.toString()} credits`);
  }
  return takes;
}

// ---------------------------------------------------------------------------
// Grant
// ---------------------------------------------------------------------------

export type GrantResult =
  | {
      readonly status: "granted";
      readonly lotId: string;
      readonly expiresAt: Date;
      readonly state: WalletState;
    }
  | { readonly status: "duplicate" };

export interface GrantInput {
  readonly accountId: string;
  readonly credits: bigint;
  readonly source: LotSource;
  readonly idempotencyKey: string;
  readonly purchaseId?: string | null;
  /** Defaults to now + `wallet.lot_validity_months`. Bonus lots pass the purchase's expiry. */
  readonly expiresAt?: Date;
  readonly now?: Date;
}

export async function grantCredits(pool: Pool, input: GrantInput): Promise<GrantResult> {
  return withTransaction(pool, (tx) => grantCreditsInTx(tx, input));
}

/**
 * Grant inside a caller's transaction, so a purchase can grant credits, issue its tax
 * invoice and mark itself credited atomically (SPEC §13). Lock order: the caller's own
 * rows first, then the wallet, then the audit log.
 */
export async function grantCreditsInTx(
  tx: PoolClient,
  input: GrantInput,
): Promise<GrantResult> {
  if (input.credits <= 0n) throw new RangeError("grantCredits: credits must be positive");
  const now = input.now ?? new Date();

  let state = await lockWallet(tx, input.accountId);
  if (await keyAlreadyApplied(tx, input.idempotencyKey)) return { status: "duplicate" };
  state = await expireDueLots(tx, input.accountId, state, now);

  const expiresAt =
    input.expiresAt ?? addCalendarMonthsUtc(now, await lotValidityMonths(tx));
  const lot = await tx.query<{ id: string }>(
    `insert into public.credit_lots
       (account_id, source, credits_granted, credits_remaining, expires_at, purchase_id, created_at)
     values ($1, $2, $3, $3, $4, $5, $6)
     returning id, expires_at`,
    [
      input.accountId,
      input.source,
      input.credits.toString(),
      expiresAt,
      input.purchaseId ?? null,
      now,
    ],
  );
  const lotId = lot.rows[0]?.id;
  if (lotId === undefined) throw new Error("grantCredits: lot insert returned no id");

  state = { balance: state.balance + input.credits, held: state.held };
  await appendLedger(tx, {
    accountId: input.accountId,
    entryType: "grant",
    amount: input.credits,
    lotId,
    balanceAfter: state.balance,
    heldAfter: state.held,
    idempotencyKey: input.idempotencyKey,
  });
  await saveWallet(tx, input.accountId, state);
  return { status: "granted", lotId, expiresAt, state };
}

// ---------------------------------------------------------------------------
// Reserve
// ---------------------------------------------------------------------------

export type ReserveResult =
  | {
      readonly ok: true;
      readonly reservationId: string;
      readonly expiresAt: Date;
      readonly duplicate: boolean;
    }
  | {
      readonly ok: false;
      readonly code: "INSUFFICIENT_CREDITS";
      readonly available: bigint;
      readonly shortfall: bigint;
    };

export async function reserveCredits(
  pool: Pool,
  input: {
    accountId: string;
    amount: bigint;
    kind: ReservationKind;
    subject: ReservationSubject;
    idempotencyKey: string;
    now?: Date;
  },
): Promise<ReserveResult> {
  if (input.amount <= 0n) throw new RangeError("reserveCredits: amount must be positive");
  const now = input.now ?? new Date();
  const ttl = await readConfig(pool, "wallet.reservation_ttl_seconds", ttlSchema);

  return withTransaction(pool, async (tx) => {
    let state = await lockWallet(tx, input.accountId);

    const existing = await tx.query<{ id: string; expires_at: Date }>(
      `select id, expires_at from public.reservations where account_id = $1 and idempotency_key = $2`,
      [input.accountId, input.idempotencyKey],
    );
    const prior = existing.rows[0];
    if (prior !== undefined) {
      return {
        ok: true,
        reservationId: prior.id,
        expiresAt: prior.expires_at,
        duplicate: true,
      };
    }

    state = await expireDueLots(tx, input.accountId, state, now);
    const available = state.balance - state.held;
    if (available < input.amount) {
      // Persist any expiry that just happened even though the reservation is refused.
      await saveWallet(tx, input.accountId, state);
      return {
        ok: false,
        code: "INSUFFICIENT_CREDITS",
        available,
        shortfall: input.amount - available,
      };
    }

    const expiresAt = new Date(now.getTime() + ttl[input.kind] * 1000);
    const jobId = "jobId" in input.subject ? input.subject.jobId : null;
    const chatMessageId =
      "chatMessageId" in input.subject ? input.subject.chatMessageId : null;
    const companyId = "companyId" in input.subject ? input.subject.companyId : null;
    const inserted = await tx.query<{ id: string }>(
      `insert into public.reservations
         (account_id, job_id, chat_message_id, company_id, amount, status, kind, expires_at, heartbeat_at,
          idempotency_key, created_at)
       values ($1, $2, $3, $9, $4, 'held', $5, $6, $7, $8, $7)
       returning id`,
      [
        input.accountId,
        jobId,
        chatMessageId,
        input.amount.toString(),
        input.kind,
        expiresAt,
        now,
        input.idempotencyKey,
        companyId,
      ],
    );
    const reservationId = inserted.rows[0]?.id;
    if (reservationId === undefined)
      throw new Error("reserveCredits: insert returned no id");

    state = { balance: state.balance, held: state.held + input.amount };
    await appendLedger(tx, {
      accountId: input.accountId,
      entryType: "reserve",
      amount: input.amount,
      reservationId,
      jobId,
      balanceAfter: state.balance,
      heldAfter: state.held,
      idempotencyKey: `reserve:${reservationId}`,
    });
    await saveWallet(tx, input.accountId, state);
    return { ok: true, reservationId, expiresAt, duplicate: false };
  });
}

// ---------------------------------------------------------------------------
// Capture and release
// ---------------------------------------------------------------------------

export class ReservationStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReservationStateError";
  }
}

interface ReservationRow {
  id: string;
  account_id: string;
  job_id: string | null;
  amount: string;
  status: string;
  captured_amount: string;
}

async function accountOfReservation(pool: Pool, reservationId: string): Promise<string> {
  const r = await pool.query<{ account_id: string }>(
    `select account_id from public.reservations where id = $1`,
    [reservationId],
  );
  const accountId = r.rows[0]?.account_id;
  if (accountId === undefined)
    throw new ReservationStateError(`reservation ${reservationId} not found`);
  return accountId;
}

export type CaptureResult =
  | {
      readonly status: "captured";
      /** May be less than requested if lot expiry shrank the hold (SPEC §11.5). */
      readonly captured: bigint;
      readonly released: bigint;
      readonly state: WalletState;
    }
  | { readonly status: "duplicate"; readonly captured: bigint };

/**
 * Capture up to `amount` from a held reservation, consuming lots FIFO by earliest expiry,
 * and release the remainder of the hold (SPEC §11.3).
 */
export async function captureReservation(
  pool: Pool,
  input: { reservationId: string; amount: bigint; idempotencyKey: string; now?: Date },
): Promise<CaptureResult> {
  if (input.amount < 0n)
    throw new RangeError("captureReservation: amount must not be negative");
  const now = input.now ?? new Date();
  const accountId = await accountOfReservation(pool, input.reservationId);

  return withTransaction(pool, async (tx) => {
    let state = await lockWallet(tx, accountId);

    if (await keyAlreadyApplied(tx, input.idempotencyKey)) {
      const r = await tx.query<{ captured_amount: string }>(
        `select captured_amount from public.reservations where id = $1`,
        [input.reservationId],
      );
      return { status: "duplicate", captured: BigInt(r.rows[0]?.captured_amount ?? "0") };
    }

    state = await expireDueLots(tx, accountId, state, now);

    const resRows = await tx.query<ReservationRow>(
      `select id, account_id, job_id, amount, status, captured_amount
       from public.reservations where id = $1 for update`,
      [input.reservationId],
    );
    const res = resRows.rows[0];
    if (res === undefined) throw new ReservationStateError("reservation vanished");
    if (res.status !== "held") {
      await saveWallet(tx, accountId, state);
      // Lot expiry can release a hold entirely (SPEC §11.5). Capturing against that is a
      // zero capture the job must handle. Capturing after an ordinary release is a bug.
      const byExpiry = await tx.query(
        `select 1 from public.credit_ledger
         where reservation_id = $1 and idempotency_key like 'expiry-cover:%' limit 1`,
        [input.reservationId],
      );
      if (res.status === "released" && (byExpiry.rowCount ?? 0) > 0) {
        return { status: "captured", captured: 0n, released: 0n, state };
      }
      throw new ReservationStateError(`reservation is ${res.status}, not held`);
    }

    const held = BigInt(res.amount);
    if (input.amount > held) {
      // More than the current hold is allowed only when expiry shrank it; more than was
      // ever reserved is a caller bug.
      const original = await tx.query<{ amount: string }>(
        `select amount from public.credit_ledger
         where reservation_id = $1 and entry_type = 'reserve' order by seq limit 1`,
        [input.reservationId],
      );
      const reservedOriginally = BigInt(original.rows[0]?.amount ?? res.amount);
      if (input.amount > reservedOriginally) {
        throw new RangeError("captureReservation: amount exceeds the reservation");
      }
    }
    const capture = input.amount < held ? input.amount : held;
    const release = held - capture;

    let index = 0;
    if (capture > 0n) {
      for (const take of await consumeLotsFifo(tx, accountId, capture, now)) {
        state = { balance: state.balance - take.taken, held: state.held - take.taken };
        await appendLedger(tx, {
          accountId,
          entryType: "capture",
          amount: take.taken,
          lotId: take.lotId,
          reservationId: res.id,
          jobId: res.job_id,
          balanceAfter: state.balance,
          heldAfter: state.held,
          idempotencyKey:
            index === 0
              ? input.idempotencyKey
              : `${input.idempotencyKey}#${String(index)}`,
        });
        index++;
      }
    }
    if (release > 0n) {
      state = { balance: state.balance, held: state.held - release };
      await appendLedger(tx, {
        accountId,
        entryType: "release",
        amount: release,
        reservationId: res.id,
        jobId: res.job_id,
        balanceAfter: state.balance,
        heldAfter: state.held,
        idempotencyKey:
          capture > 0n ? `${input.idempotencyKey}#release` : input.idempotencyKey,
      });
    }

    await tx.query(
      `update public.reservations
       set status = $2, captured_amount = $3, settled_at = $4
       where id = $1`,
      [
        res.id,
        capture === held
          ? "captured"
          : capture === 0n
            ? "released"
            : "partially_captured",
        capture.toString(),
        now,
      ],
    );
    await saveWallet(tx, accountId, state);
    return { status: "captured", captured: capture, released: release, state };
  });
}

export type ReleaseResult =
  | {
      readonly status: "released";
      readonly released: bigint;
      readonly state: WalletState;
    }
  | { readonly status: "not_held"; readonly currentStatus: string };

export async function releaseReservation(
  pool: Pool,
  input: { reservationId: string; idempotencyKey: string; now?: Date; expired?: boolean },
): Promise<ReleaseResult> {
  const now = input.now ?? new Date();
  const accountId = await accountOfReservation(pool, input.reservationId);

  return withTransaction(pool, async (tx) => {
    let state = await lockWallet(tx, accountId);
    state = await expireDueLots(tx, accountId, state, now);
    const resRows = await tx.query<ReservationRow>(
      `select id, account_id, job_id, amount, status, captured_amount
       from public.reservations where id = $1 for update`,
      [input.reservationId],
    );
    const res = resRows.rows[0];
    if (res === undefined) throw new ReservationStateError("reservation vanished");
    if (res.status !== "held") {
      await saveWallet(tx, accountId, state);
      return { status: "not_held", currentStatus: res.status };
    }

    const amount = BigInt(res.amount);
    state = { balance: state.balance, held: state.held - amount };
    await appendLedger(tx, {
      accountId,
      entryType: "release",
      amount,
      reservationId: res.id,
      jobId: res.job_id,
      balanceAfter: state.balance,
      heldAfter: state.held,
      idempotencyKey: input.idempotencyKey,
    });
    await tx.query(
      `update public.reservations set status = $2, settled_at = $3 where id = $1`,
      [res.id, input.expired === true ? "expired" : "released", now],
    );
    await saveWallet(tx, accountId, state);
    return { status: "released", released: amount, state };
  });
}

/** Jobs send heartbeats while running; the sweeper spares holds with a recent one. */
export async function heartbeatReservation(
  db: Queryable,
  reservationId: string,
  now = new Date(),
): Promise<boolean> {
  const r = await db.query(
    `update public.reservations set heartbeat_at = $2 where id = $1 and status = 'held'`,
    [reservationId, now],
  );
  return (r.rowCount ?? 0) === 1;
}

// ---------------------------------------------------------------------------
// Admin adjustment (SPEC §11.7)
// ---------------------------------------------------------------------------

export type AdjustResult =
  | { readonly status: "adjusted"; readonly state: WalletState }
  | { readonly status: "duplicate" }
  | { readonly status: "insufficient_available"; readonly available: bigint };

export async function adminAdjust(
  pool: Pool,
  input: {
    accountId: string;
    delta: bigint;
    reason: string;
    adminId: string;
    idempotencyKey: string;
    ip?: string | null;
    now?: Date;
  },
): Promise<AdjustResult> {
  if (input.delta === 0n) throw new RangeError("adminAdjust: delta must be non-zero");
  if (input.reason.trim().length < 5)
    throw new RangeError("adminAdjust: a reason is required");
  const now = input.now ?? new Date();

  return withTransaction(pool, async (tx) => {
    let state = await lockWallet(tx, input.accountId);
    if (await keyAlreadyApplied(tx, input.idempotencyKey)) return { status: "duplicate" };
    state = await expireDueLots(tx, input.accountId, state, now);

    if (input.delta > 0n) {
      const expiresAt = addCalendarMonthsUtc(now, await lotValidityMonths(tx));
      const lot = await tx.query<{ id: string }>(
        `insert into public.credit_lots
           (account_id, source, credits_granted, credits_remaining, expires_at, created_at)
         values ($1, 'admin_grant', $2, $2, $3, $4) returning id`,
        [input.accountId, input.delta.toString(), expiresAt, now],
      );
      state = { balance: state.balance + input.delta, held: state.held };
      await appendLedger(tx, {
        accountId: input.accountId,
        entryType: "admin_adjust",
        amount: input.delta,
        lotId: lot.rows[0]?.id ?? null,
        balanceAfter: state.balance,
        heldAfter: state.held,
        idempotencyKey: input.idempotencyKey,
      });
    } else {
      const need = -input.delta;
      const available = state.balance - state.held;
      // A negative adjustment never eats credits that back a running job's hold.
      if (need > available) {
        await saveWallet(tx, input.accountId, state);
        return { status: "insufficient_available", available };
      }
      let index = 0;
      for (const take of await consumeLotsFifo(tx, input.accountId, need, now)) {
        state = { balance: state.balance - take.taken, held: state.held };
        await appendLedger(tx, {
          accountId: input.accountId,
          entryType: "admin_adjust",
          amount: -take.taken,
          lotId: take.lotId,
          balanceAfter: state.balance,
          heldAfter: state.held,
          idempotencyKey:
            index === 0
              ? input.idempotencyKey
              : `${input.idempotencyKey}#${String(index)}`,
        });
        index++;
      }
    }

    await appendAudit(tx, {
      actorType: "admin",
      actorId: input.adminId,
      action: "wallet.admin_adjust",
      targetType: "account",
      targetId: input.accountId,
      metadata: { delta: input.delta.toString(), reason: input.reason.trim() },
      ip: input.ip ?? null,
    });
    await saveWallet(tx, input.accountId, state);
    return { status: "adjusted", state };
  });
}

// ---------------------------------------------------------------------------
// Sweeps (run by the worker)
// ---------------------------------------------------------------------------

/** Nightly: expire due lots for every account that has any (SPEC §11.5). */
export async function expireLotsSweep(pool: Pool, now = new Date()): Promise<number> {
  const accounts = await pool.query<{ account_id: string }>(
    `select distinct account_id from public.credit_lots where credits_remaining > 0 and expires_at <= $1`,
    [now],
  );
  for (const { account_id } of accounts.rows) {
    await withTransaction(pool, async (tx) => {
      const state = await lockWallet(tx, account_id);
      await saveWallet(tx, account_id, await expireDueLots(tx, account_id, state, now));
    });
  }
  return accounts.rows.length;
}

/**
 * Every 5 minutes: release expired holds whose job has stopped sending heartbeats, and
 * move the job to `expired` (SPEC §11.6).
 */
export async function sweepExpiredReservations(
  pool: Pool,
  now = new Date(),
): Promise<number> {
  const stale = await readConfig(
    pool,
    "wallet.heartbeat_stale_seconds",
    z.number().int().positive(),
  );
  const cutoff = new Date(now.getTime() - stale * 1000);
  const due = await pool.query<{ id: string; job_id: string | null }>(
    `select id, job_id from public.reservations
     where status = 'held' and expires_at < $1 and (heartbeat_at is null or heartbeat_at < $2)
       -- Jobs awaiting review, or that made an AI call, owe the cancel_after_ai_fee on expiry (SPEC §23);
       -- @magicmis/jobs settles those, so the plain sweeper leaves them alone.
       and not exists (
         select 1 from public.jobs j where j.id = reservations.job_id
           and (j.state = 'awaiting_review' or exists (select 1 from public.ai_calls c where c.job_id = j.id)))`,
    [now, cutoff],
  );

  let released = 0;
  for (const res of due.rows) {
    const result = await releaseReservation(pool, {
      reservationId: res.id,
      idempotencyKey: `sweep:${res.id}`,
      now,
      expired: true,
    });
    if (result.status !== "released") continue;
    released++;
    if (res.job_id !== null) {
      await pool.query(
        `update public.jobs set state = 'expired', failure_class = 'expired', completed_at = $2
         where id = $1 and state not in ('completed','failed_data','failed_platform','cancelled','expired')`,
        [res.job_id, now],
      );
    }
  }
  return released;
}

/** Queue "credits expiring soon" emails at the configured horizons (SPEC §11.5, §29). */
export async function queueLotExpiryNotices(
  pool: Pool,
  now = new Date(),
): Promise<number> {
  const days = await readConfig(
    pool,
    "wallet.lot_expiry_notice_days",
    z.array(z.number().int().positive()),
  );
  let queued = 0;
  for (const d of days) {
    const from = new Date(now.getTime() + (d - 1) * 86_400_000);
    const to = new Date(now.getTime() + d * 86_400_000);
    const result = await pool.query(
      `insert into public.notifications (account_id, type, payload, dedupe_key)
       select l.account_id, 'billing.lot_expiry_notice',
              jsonb_build_object('credits', l.credits_remaining::text, 'expires_at', l.expires_at, 'days', $3::int),
              'lot_expiry:' || l.id || ':' || $3::text
       from public.credit_lots l
       where l.credits_remaining > 0 and l.expires_at > $1 and l.expires_at <= $2
       on conflict (account_id, dedupe_key) do nothing`,
      [from, to, d],
    );
    queued += result.rowCount ?? 0;
  }
  return queued;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface WalletSummary {
  readonly balance: bigint;
  readonly held: bigint;
  readonly available: bigint;
  readonly lots: readonly {
    id: string;
    source: LotSource;
    remaining: bigint;
    granted: bigint;
    expiresAt: Date;
  }[];
}

export async function walletSummary(
  db: Queryable,
  accountId: string,
  now = new Date(),
): Promise<WalletSummary> {
  const wallet = await db.query<{ balance_credits: string; held_credits: string }>(
    `select balance_credits, held_credits from public.wallets where account_id = $1`,
    [accountId],
  );
  const lots = await db.query<{
    id: string;
    source: LotSource;
    credits_remaining: string;
    credits_granted: string;
    expires_at: Date;
  }>(
    `select id, source, credits_remaining, credits_granted, expires_at from public.credit_lots
     where account_id = $1 and credits_remaining > 0 and expires_at > $2
     order by expires_at, created_at`,
    [accountId, now],
  );
  const balance = BigInt(wallet.rows[0]?.balance_credits ?? "0");
  const held = BigInt(wallet.rows[0]?.held_credits ?? "0");
  return {
    balance,
    held,
    available: balance - held,
    lots: lots.rows.map((l) => ({
      id: l.id,
      source: l.source,
      remaining: BigInt(l.credits_remaining),
      granted: BigInt(l.credits_granted),
      expiresAt: l.expires_at,
    })),
  };
}
