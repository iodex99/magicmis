/**
 * Tamper-evident anchors over the audit log and the credit ledger (R-52, ADR 0025).
 *
 * An anchor covers every row of a chain with `seq` in (previous anchor, through_seq]. Its digest is
 *   SHA-256(prev_digest ‖ "seq|created_at_micros|hash\n" for each row, in seq order)
 * and its MAC is HMAC-SHA-256 under the `audit_anchor` platform key (wrapped by the KMS master key) of
 *   "chain|through_seq|rows_covered|prev_digest|digest".
 *
 * Verification recomputes every digest from the live tables and checks every MAC, so any of these is
 * detected even when the attacker recomputes the row-level hash chain:
 * - an edited, inserted or deleted row inside an anchored range (its line changes the digest);
 * - a changed `created_at` (included in the digest, though not in the row hash);
 * - trimmed newest rows (the chain head falls below an anchor);
 * - a forged, edited or removed anchor (MAC or prev_digest continuity fails);
 * - anchoring stopped (the newest anchor is older than `integrity.anchor_max_age_hours`).
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { KeyWrapper } from "@magicmis/crypto";
import { readConfig } from "@magicmis/db/config";
import type { Queryable } from "@magicmis/db/tx";
import { z } from "zod";

import { platformKey, platformKeyExists } from "./platform-keys";

export const ANCHORED_CHAINS = ["audit_log", "credit_ledger"] as const;
export type AnchoredChain = (typeof ANCHORED_CHAINS)[number];

const GENESIS = "0".repeat(64);
const PAGE = 5000;

interface AnchorRow {
  id: string;
  chain: AnchoredChain;
  through_seq: string;
  rows_covered: string;
  prev_digest: string;
  digest: string;
  mac: string;
  created_at: Date;
}

/** Digest of a chain's rows in (fromSeq, toSeq], continuing from `prevDigest`. */
async function rangeDigest(
  db: Queryable,
  chain: AnchoredChain,
  fromSeq: bigint,
  toSeq: bigint,
  prevDigest: string,
): Promise<{ digest: string; rows: bigint }> {
  const hash = createHash("sha256").update(prevDigest);
  let after = fromSeq;
  let rows = 0n;
  for (;;) {
    // Microseconds since the epoch: independent of the session time zone, and exact.
    const page = await db.query<{ seq: string; micros: string; hash: string }>(
      `select seq::text as seq, (extract(epoch from created_at) * 1000000)::bigint::text as micros, hash
       from public.${chain} where seq > $1 and seq <= $2 order by seq limit $3`,
      [after.toString(), toSeq.toString(), PAGE],
    );
    for (const r of page.rows) hash.update(`${r.seq}|${r.micros}|${r.hash}\n`);
    rows += BigInt(page.rows.length);
    const last = page.rows.at(-1);
    if (last === undefined || page.rows.length < PAGE) break;
    after = BigInt(last.seq);
  }
  return { digest: hash.digest("hex"), rows };
}

const macOf = (key: Buffer, a: Omit<AnchorRow, "id" | "mac" | "created_at">) =>
  createHmac("sha256", key)
    .update(`${a.chain}|${a.through_seq}|${a.rows_covered}|${a.prev_digest}|${a.digest}`)
    .digest("hex");

const sameHex = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));

async function anchorsOf(db: Queryable, chain: AnchoredChain): Promise<AnchorRow[]> {
  const r = await db.query<AnchorRow>(
    `select id::text as id, chain, through_seq::text as through_seq, rows_covered::text as rows_covered,
            prev_digest, digest, mac, created_at
     from public.integrity_anchors where chain = $1 order by through_seq`,
    [chain],
  );
  return r.rows;
}

/**
 * Worker: anchor each chain through its newest row older than `integrity.anchor_settle_seconds`.
 * Nothing new to cover means no anchor for that chain this time.
 */
export async function createIntegrityAnchors(
  db: Queryable,
  wrapper: KeyWrapper,
  now: Date = new Date(),
): Promise<Record<AnchoredChain, { throughSeq: string; rows: string } | null>> {
  const settle = await readConfig(
    db,
    "integrity.anchor_settle_seconds",
    z.number().int().nonnegative(),
    now,
  );
  const key = await platformKey(db, wrapper, "audit_anchor");
  try {
    const out: Record<string, { throughSeq: string; rows: string } | null> = {};
    for (const chain of ANCHORED_CHAINS) {
      const previous = (await anchorsOf(db, chain)).at(-1);
      const fromSeq = BigInt(previous?.through_seq ?? "0");
      const head = await db.query<{ seq: string | null }>(
        `select max(seq)::text as seq from public.${chain} where created_at <= $1`,
        [new Date(now.getTime() - settle * 1000)],
      );
      const toSeq = BigInt(head.rows[0]?.seq ?? "0");
      if (toSeq <= fromSeq) {
        out[chain] = null;
        continue;
      }
      const prevDigest = previous?.digest ?? GENESIS;
      const { digest, rows } = await rangeDigest(db, chain, fromSeq, toSeq, prevDigest);
      const anchor = {
        chain,
        through_seq: toSeq.toString(),
        rows_covered: rows.toString(),
        prev_digest: prevDigest,
        digest,
      };
      await db.query(
        `insert into public.integrity_anchors (chain, through_seq, rows_covered, prev_digest, digest, mac, created_at)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          chain,
          anchor.through_seq,
          anchor.rows_covered,
          prevDigest,
          digest,
          macOf(key, anchor),
          now,
        ],
      );
      out[chain] = { throughSeq: anchor.through_seq, rows: anchor.rows_covered };
    }
    return out;
  } finally {
    key.fill(0);
  }
}

export interface AnchorFailure {
  readonly chain: AnchoredChain;
  readonly anchorId: string | null;
  readonly reason:
    | "bad_mac"
    | "broken_link"
    | "digest_mismatch"
    | "chain_truncated"
    | "stale"
    | "missing";
}

/** Nightly: recompute every anchor from the live tables. An empty list means both chains hold. */
export async function verifyIntegrityAnchors(
  db: Queryable,
  wrapper: KeyWrapper,
  now: Date = new Date(),
): Promise<{ anchorsChecked: number; failures: AnchorFailure[] }> {
  const [maxAgeHours, settle] = await Promise.all([
    readConfig(db, "integrity.anchor_max_age_hours", z.number().int().positive(), now),
    readConfig(
      db,
      "integrity.anchor_settle_seconds",
      z.number().int().nonnegative(),
      now,
    ),
  ]);
  const failures: AnchorFailure[] = [];
  let anchorsChecked = 0;
  const keyExists = await platformKeyExists(db, "audit_anchor");
  const key = keyExists ? await platformKey(db, wrapper, "audit_anchor") : null;
  try {
    for (const chain of ANCHORED_CHAINS) {
      const anchors = await anchorsOf(db, chain);
      const oldest = await db.query<{ first: Date | null }>(
        `select min(created_at) as first from public.${chain}`,
      );
      const firstRow = oldest.rows[0]?.first ?? null;
      // A chain with settled rows must have been anchored within the allowed age.
      const newest = anchors.at(-1);
      const dueSince = now.getTime() - (maxAgeHours * 3_600_000 + settle * 1000);
      if (newest === undefined) {
        if (firstRow !== null && firstRow.getTime() < dueSince)
          failures.push({ chain, anchorId: null, reason: "missing" });
        continue;
      }
      if (newest.created_at.getTime() < now.getTime() - maxAgeHours * 3_600_000)
        failures.push({ chain, anchorId: newest.id, reason: "stale" });

      const head = await db.query<{ seq: string | null }>(
        `select max(seq)::text as seq from public.${chain}`,
      );
      if (BigInt(head.rows[0]?.seq ?? "0") < BigInt(newest.through_seq))
        failures.push({ chain, anchorId: newest.id, reason: "chain_truncated" });

      let prevDigest = GENESIS;
      let fromSeq = 0n;
      for (const a of anchors) {
        anchorsChecked += 1;
        if (key === null || !sameHex(macOf(key, a), a.mac))
          failures.push({ chain, anchorId: a.id, reason: "bad_mac" });
        if (a.prev_digest !== prevDigest)
          failures.push({ chain, anchorId: a.id, reason: "broken_link" });
        const recomputed = await rangeDigest(
          db,
          chain,
          fromSeq,
          BigInt(a.through_seq),
          prevDigest,
        );
        if (
          recomputed.digest !== a.digest ||
          recomputed.rows.toString() !== a.rows_covered
        )
          failures.push({ chain, anchorId: a.id, reason: "digest_mismatch" });
        // Continue from the stored digest, so one tampered range is reported once, not again for
        // every later anchor.
        prevDigest = a.digest;
        fromSeq = BigInt(a.through_seq);
      }
    }
  } finally {
    key?.fill(0);
  }
  return { anchorsChecked, failures };
}

/** The newest anchor per chain, for the daily admin email (an off-database copy). */
export async function latestAnchors(
  db: Queryable,
): Promise<{ chain: string; throughSeq: string; digest: string; mac: string }[]> {
  const r = await db.query<{
    chain: string;
    through_seq: string;
    digest: string;
    mac: string;
  }>(
    `select distinct on (chain) chain, through_seq::text as through_seq, digest, mac
     from public.integrity_anchors order by chain, through_seq desc`,
  );
  return r.rows.map((a) => ({
    chain: a.chain,
    throughSeq: a.through_seq,
    digest: a.digest,
    mac: a.mac,
  }));
}
