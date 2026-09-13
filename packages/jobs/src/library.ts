/**
 * Global library candidates (SPEC §18, R-31). When an account saves rules, each eligible normalised
 * name casts one vote for its head: digests only, plus the name sealed under a platform key. A nightly
 * pass turns (name, head) pairs voted by ≥ `semantic.library_promotion_min_accounts` distinct accounts
 * into pending `library_candidates`. Promotion stays admin-only (apps/admin `decideCandidate`).
 */

import { createHmac } from "node:crypto";

import { decryptWithKey, encryptWithKey, type KeyWrapper } from "@magicmis/crypto";
import { readConfig } from "@magicmis/db/config";
import { withTransaction, type Queryable } from "@magicmis/db/tx";
import { libraryIneligibleReason, normaliseName } from "@magicmis/semantic";
import type { Pool } from "pg";
import { z } from "zod";

import { platformKey } from "./platform-keys";

/** The platform library key, created on first use. Caller must zero the returned buffer. */
const libraryKey = (db: Queryable, wrapper: KeyWrapper) =>
  platformKey(db, wrapper, "library");

const digest = (key: Buffer, label: string, value: string) =>
  createHmac("sha256", key).update(`${label}:${value}`).digest();

/**
 * Records this account's votes for its saved rules. A re-saved name replaces the account's earlier
 * vote for that name, whatever head it had. Ineligible names are skipped silently.
 */
export async function recordLibraryVotes(
  pool: Pool,
  wrapper: KeyWrapper,
  input: { accountId: string; rules: readonly { pattern: string; head: string }[] },
): Promise<number> {
  const eligible = new Map<string, string>();
  for (const rule of input.rules) {
    const name = normaliseName(rule.pattern);
    if (libraryIneligibleReason(name) === null) eligible.set(name, rule.head);
  }
  if (eligible.size === 0) return 0;
  return withTransaction(pool, async (tx) => {
    const key = await libraryKey(tx, wrapper);
    try {
      const accountDigest = digest(key, "account", input.accountId);
      for (const [name, head] of eligible) {
        const nameDigest = digest(key, "name", name);
        await tx.query(
          `delete from public.library_votes where name_digest = $1 and account_digest = $2`,
          [nameDigest, accountDigest],
        );
        await tx.query(
          `insert into public.library_votes (name_digest, mis_head_id, account_digest, sealed_name)
           select $1, h.id, $2, $3 from public.mis_heads h where h.code = $4`,
          [
            nameDigest,
            accountDigest,
            encryptWithKey(key, Buffer.from(name, "utf8"), { purpose: "library_name" }),
            head,
          ],
        );
      }
      return eligible.size;
    } finally {
      key.fill(0);
    }
  });
}

/** On account purge: the account's votes go, so it no longer counts toward any candidate. */
export async function removeLibraryVotes(
  db: Queryable,
  wrapper: KeyWrapper,
  accountId: string,
): Promise<void> {
  const exists = await db.query(
    `select 1 from public.platform_keys where purpose = 'library'`,
  );
  if (exists.rows.length === 0) return;
  const key = await libraryKey(db, wrapper);
  try {
    await db.query(`delete from public.library_votes where account_digest = $1`, [
      digest(key, "account", accountId),
    ]);
  } finally {
    key.fill(0);
  }
}

/**
 * Nightly: (name, head) pairs with enough distinct accounts become pending candidates, or refresh the
 * count on an existing pending one. Names already in the global library and decided candidates are
 * left alone.
 */
export async function refreshLibraryCandidates(
  pool: Pool,
  wrapper: KeyWrapper,
): Promise<{ candidates: number }> {
  const min = await readConfig(
    pool,
    "semantic.library_promotion_min_accounts",
    z.number().int().positive(),
  );
  const groups = await pool.query<{
    mis_head_id: string;
    accounts: number;
    sealed_name: Buffer;
  }>(
    `select mis_head_id, count(distinct account_digest)::int as accounts, (array_agg(sealed_name))[1] as sealed_name
     from public.library_votes group by name_digest, mis_head_id having count(distinct account_digest) >= $1`,
    [min],
  );
  const pending = await pool.query<{
    id: string;
    normalized_name: string;
    proposed_mis_head_id: string;
  }>(
    `select id, normalized_name, proposed_mis_head_id from public.library_candidates where status = 'pending'`,
  );
  if (groups.rows.length === 0 && pending.rows.length === 0) return { candidates: 0 };
  const key = await libraryKey(pool, wrapper);
  let candidates = 0;
  try {
    // Pending candidates show today's count, including after purged accounts stop counting.
    for (const c of pending.rows) {
      await pool.query(
        `update public.library_candidates set distinct_account_count = (
           select count(distinct account_digest)::int from public.library_votes
           where name_digest = $2 and mis_head_id = $3)
         where id = $1 and status = 'pending'`,
        [c.id, digest(key, "name", c.normalized_name), c.proposed_mis_head_id],
      );
    }
    for (const g of groups.rows) {
      const name = decryptWithKey(key, g.sealed_name, {
        purpose: "library_name",
      }).toString("utf8");
      // Re-check with today's heuristics: a word list tightened since the vote still excludes it.
      if (libraryIneligibleReason(name) !== null) continue;
      const r = await pool.query(
        `insert into public.library_candidates (normalized_name, proposed_mis_head_id, distinct_account_count)
         select $1, $2, $3
         where not exists (select 1 from public.global_mapping_library where normalized_name = $1)
         on conflict (normalized_name, proposed_mis_head_id) do update
           set distinct_account_count = excluded.distinct_account_count
           where public.library_candidates.status = 'pending'`,
        [name, g.mis_head_id, g.accounts],
      );
      candidates += r.rowCount ?? 0;
    }
  } finally {
    key.fill(0);
  }
  return { candidates };
}
