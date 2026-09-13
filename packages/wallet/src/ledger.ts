/**
 * The credit ledger: append-only, per-account hash-chained (SPEC §9, §11).
 *
 * Every function here must be called inside a transaction that already holds the
 * account's `wallets` row lock. That lock is what serialises writes per account, which in
 * turn is what makes "the latest row by seq" a safe predecessor for the chain.
 */

import { computeHash, GENESIS_HASH, type ChainValue } from "@magicmis/core/hashchain";
import type { Queryable } from "@magicmis/db/tx";

export type LedgerEntryType =
  "grant" | "reserve" | "release" | "capture" | "expire" | "admin_adjust";

export interface LedgerEntryInput {
  readonly accountId: string;
  readonly entryType: LedgerEntryType;
  /**
   * Magnitude for every type except `admin_adjust`, which is signed. The effect on balance
   * and held is determined by the type (see `applyEntry`), never by the sign alone.
   */
  readonly amount: bigint;
  readonly lotId?: string | null;
  readonly reservationId?: string | null;
  readonly jobId?: string | null;
  readonly balanceAfter: bigint;
  readonly heldAfter: bigint;
  readonly idempotencyKey: string;
}

export interface WalletState {
  readonly balance: bigint;
  readonly held: bigint;
}

/**
 * The effect of one ledger entry on wallet state. This single function is the definition
 * the replay property test holds the database to.
 */
export function applyEntry(
  state: WalletState,
  type: LedgerEntryType,
  amount: bigint,
): WalletState {
  switch (type) {
    case "grant":
    case "admin_adjust":
      return { balance: state.balance + amount, held: state.held };
    case "reserve":
      return { balance: state.balance, held: state.held + amount };
    case "release":
      return { balance: state.balance, held: state.held - amount };
    case "capture":
      return { balance: state.balance - amount, held: state.held - amount };
    case "expire":
      return { balance: state.balance - amount, held: state.held };
  }
}

function payloadOf(e: LedgerEntryInput): ChainValue {
  return {
    accountId: e.accountId,
    entryType: e.entryType,
    amount: e.amount,
    lotId: e.lotId ?? null,
    reservationId: e.reservationId ?? null,
    jobId: e.jobId ?? null,
    balanceAfter: e.balanceAfter,
    heldAfter: e.heldAfter,
    idempotencyKey: e.idempotencyKey,
  };
}

export async function appendLedger(
  tx: Queryable,
  entry: LedgerEntryInput,
): Promise<string> {
  const tail = await tx.query<{ hash: string }>(
    `select hash from public.credit_ledger where account_id = $1 order by seq desc limit 1`,
    [entry.accountId],
  );
  const prevHash = tail.rows[0]?.hash ?? GENESIS_HASH;
  const hash = computeHash(prevHash, payloadOf(entry));
  const inserted = await tx.query<{ id: string }>(
    `insert into public.credit_ledger
       (account_id, entry_type, amount, lot_id, reservation_id, job_id,
        balance_after, held_after, idempotency_key, prev_hash, hash)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     returning id`,
    [
      entry.accountId,
      entry.entryType,
      entry.amount.toString(),
      entry.lotId ?? null,
      entry.reservationId ?? null,
      entry.jobId ?? null,
      entry.balanceAfter.toString(),
      entry.heldAfter.toString(),
      entry.idempotencyKey,
      prevHash,
      hash,
    ],
  );
  const id = inserted.rows[0]?.id;
  if (id === undefined) throw new Error("appendLedger: insert returned no id");
  return id;
}

export interface LedgerRow {
  readonly seq: bigint;
  readonly entryType: LedgerEntryType;
  readonly amount: bigint;
  readonly lotId: string | null;
  readonly reservationId: string | null;
  readonly jobId: string | null;
  readonly balanceAfter: bigint;
  readonly heldAfter: bigint;
  readonly idempotencyKey: string;
  readonly prevHash: string;
  readonly hash: string;
  readonly createdAt: Date;
}

export async function readLedger(db: Queryable, accountId: string): Promise<LedgerRow[]> {
  // The cast is aliased seq_text, never seq: `order by seq` would then resolve to the text
  // output column and sort "107" before "93". This exact defect was found and documented
  // in the audit log verifier (ADR 0004) and reintroduced here, caught by the tests.
  const result = await db.query<{
    seq_text: string;
    entry_type: LedgerEntryType;
    amount: string;
    lot_id: string | null;
    reservation_id: string | null;
    job_id: string | null;
    balance_after: string;
    held_after: string;
    idempotency_key: string;
    prev_hash: string;
    hash: string;
    created_at: Date;
  }>(
    `select seq::text as seq_text, entry_type, amount::text as amount, lot_id, reservation_id, job_id,
            balance_after::text as balance_after, held_after::text as held_after,
            idempotency_key, prev_hash, hash, created_at
     from public.credit_ledger where account_id = $1 order by seq`,
    [accountId],
  );
  return result.rows.map((r) => ({
    seq: BigInt(r.seq_text),
    entryType: r.entry_type,
    amount: BigInt(r.amount),
    lotId: r.lot_id,
    reservationId: r.reservation_id,
    jobId: r.job_id,
    balanceAfter: BigInt(r.balance_after),
    heldAfter: BigInt(r.held_after),
    idempotencyKey: r.idempotency_key,
    prevHash: r.prev_hash,
    hash: r.hash,
    createdAt: r.created_at,
  }));
}

export interface ReplayResult {
  readonly state: WalletState;
  /** Rows whose recorded after-state does not follow from the previous row. */
  readonly inconsistentSeqs: readonly bigint[];
  /** Rows whose hash chain does not verify. */
  readonly brokenChainSeqs: readonly bigint[];
}

/**
 * Replay a ledger from zero. SPEC §11 requires this to reproduce the `wallets` row exactly;
 * the property test asserts it for arbitrary operation sequences.
 */
export function replayLedger(
  accountId: string,
  rows: readonly LedgerRow[],
): ReplayResult {
  let state: WalletState = { balance: 0n, held: 0n };
  let prevHash = GENESIS_HASH;
  const inconsistent: bigint[] = [];
  const broken: bigint[] = [];

  for (const row of rows) {
    state = applyEntry(state, row.entryType, row.amount);
    if (state.balance !== row.balanceAfter || state.held !== row.heldAfter)
      inconsistent.push(row.seq);

    const expected = computeHash(
      row.prevHash,
      payloadOf({
        accountId,
        entryType: row.entryType,
        amount: row.amount,
        lotId: row.lotId,
        reservationId: row.reservationId,
        jobId: row.jobId,
        balanceAfter: row.balanceAfter,
        heldAfter: row.heldAfter,
        idempotencyKey: row.idempotencyKey,
      }),
    );
    if (row.prevHash !== prevHash || expected !== row.hash) broken.push(row.seq);
    prevHash = row.hash;
  }

  return { state, inconsistentSeqs: inconsistent, brokenChainSeqs: broken };
}
