/**
 * Append-only audit log writer and verifier (SPEC §4, §9, §30).
 *
 * Appends are serialised with a Postgres advisory lock. Without it, two concurrent
 * writers both read the same tail hash and produce two entries claiming the same
 * predecessor -- a chain that is permanently broken by ordinary traffic rather than by
 * tampering, which is exactly how a security control becomes an ignored alert.
 */

import { computeHash, GENESIS_HASH, type ChainValue } from "@magicmis/core/hashchain";
import type { Pool, PoolClient } from "pg";

/** Distinct per chain. Arbitrary but must never collide with another advisory lock. */
const AUDIT_LOCK_KEY = 0x4d_49_53_01; // "MIS\x01"

export type ActorType = "account" | "admin" | "system";

export interface AuditEntry {
  readonly actorType: ActorType;
  readonly actorId?: string | null;
  readonly action: string;
  readonly targetType?: string | null;
  readonly targetId?: string | null;
  /** SPEC §9: ids, labels and outcomes. Never financial values or file content. */
  readonly metadata?: Record<string, ChainValue>;
  readonly ip?: string | null;
}

export interface AppendedAudit {
  readonly id: string;
  readonly hash: string;
  readonly prevHash: string;
}

/**
 * The payload that is hashed.
 *
 * Note `created_at` is NOT part of it. The database assigns the timestamp with its own
 * clock after the hash is computed; including it would force a round trip to learn the
 * value being hashed, and the ordering guarantee already comes from the chain itself.
 */
function chainPayload(entry: AuditEntry): ChainValue {
  return {
    actorType: entry.actorType,
    actorId: entry.actorId ?? null,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    metadata: entry.metadata ?? {},
    ip: entry.ip ?? null,
  };
}

/**
 * Append one entry.
 *
 * Must run inside a transaction: the advisory lock is transaction-scoped, so it is
 * released by the same COMMIT that makes the row visible. Taking it outside would let
 * the next writer read a tail that has not landed yet.
 */
export async function appendAudit(
  client: PoolClient,
  entry: AuditEntry,
): Promise<AppendedAudit> {
  await client.query("select pg_advisory_xact_lock($1)", [AUDIT_LOCK_KEY]);

  // Ordered by seq, never by created_at: see the column comment in 0009.
  const tail = await client.query<{ hash: string }>(
    `select hash from public.audit_log order by seq desc limit 1`,
  );
  const prevHash = tail.rows[0]?.hash ?? GENESIS_HASH;
  const payload = chainPayload(entry);
  const hash = computeHash(prevHash, payload);

  const inserted = await client.query<{ id: string }>(
    `insert into public.audit_log
       (actor_type, actor_id, action, target_type, target_id, metadata, ip, prev_hash, hash)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning id`,
    [
      entry.actorType,
      entry.actorId ?? null,
      entry.action,
      entry.targetType ?? null,
      entry.targetId ?? null,
      JSON.stringify(entry.metadata ?? {}),
      entry.ip ?? null,
      prevHash,
      hash,
    ],
  );

  const id = inserted.rows[0]?.id;
  if (id === undefined) throw new Error("appendAudit: insert returned no id");
  return { id, hash, prevHash };
}

/** Convenience wrapper that opens and commits its own transaction. */
export async function appendAuditInTransaction(
  pool: Pool,
  entry: AuditEntry,
): Promise<AppendedAudit> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await appendAudit(client, entry);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export interface ChainVerification {
  readonly ok: boolean;
  readonly checked: number;
  readonly failures: {
    readonly id: string;
    readonly reason: "broken_link" | "bad_hash";
    readonly expected: string;
    readonly actual: string;
  }[];
}

/**
 * Walk the whole chain in insertion order (SPEC §30: runs nightly, alerts on mismatch).
 *
 * Streams in pages rather than loading the table, because this runs against a log that
 * only ever grows.
 */
export async function verifyAuditChain(pool: Pool, pageSize = 1000): Promise<ChainVerification> {
  const failures: ChainVerification["failures"] = [];
  let expectedPrev = GENESIS_HASH;
  let checked = 0;
  let afterSeq = "0";

  for (;;) {
    const page: {
      rows: {
        id: string;
        seq_text: string;
        actor_type: ActorType;
        actor_id: string | null;
        action: string;
        target_type: string | null;
        target_id: string | null;
        metadata: Record<string, ChainValue>;
        ip: string | null;
        prev_hash: string;
        hash: string;
      }[];
    } = await pool.query(
      // The cast is aliased seq_text, NOT seq. `order by seq` would otherwise resolve to
      // the output column -- the text cast -- and sort 1,10,11,...,2,20 lexicographically,
      // walking the chain out of order and reporting spurious broken links. seq is
      // returned as text only because bigint exceeds the precision of a JS number.
      `select id, seq::text as seq_text, actor_type, actor_id, action, target_type, target_id,
              metadata, host(ip) as ip, prev_hash, hash
       from public.audit_log
       where seq > $1::bigint
       order by seq
       limit $2`,
      [afterSeq, pageSize],
    );

    if (page.rows.length === 0) break;

    for (const row of page.rows) {
      checked++;
      if (row.prev_hash !== expectedPrev) {
        failures.push({
          id: row.id,
          reason: "broken_link",
          expected: expectedPrev,
          actual: row.prev_hash,
        });
      }
      const recomputed = computeHash(row.prev_hash, {
        actorType: row.actor_type,
        actorId: row.actor_id,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        metadata: row.metadata,
        ip: row.ip,
      });
      if (recomputed !== row.hash) {
        failures.push({ id: row.id, reason: "bad_hash", expected: recomputed, actual: row.hash });
      }
      expectedPrev = row.hash;
    }

    const last = page.rows.at(-1);
    if (last === undefined) break;
    afterSeq = last.seq_text;
    if (page.rows.length < pageSize) break;
  }

  return { ok: failures.length === 0, checked, failures };
}
