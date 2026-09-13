/**
 * Quotes (SPEC §12): offered when an estimate exceeds the AI cost cap, when a job hits the
 * runtime cap, for restructures, and for admin-issued Expert+ work. Valid for a configured
 * window; a job proceeds only after acceptance.
 */

import { readConfig } from "@magicmis/db/config";
import { withTransaction, type Queryable } from "@magicmis/db/tx";
import type { Pool } from "pg";
import { z } from "zod";

export type QuoteReason =
  "estimate_over_cap" | "runtime_cap" | "restructure" | "expert_plus";

export async function createQuote(
  db: Queryable,
  input: {
    accountId: string;
    jobId: string | null;
    reason: QuoteReason;
    credits: bigint;
    now?: Date;
  },
): Promise<{ quoteId: string; expiresAt: Date }> {
  if (input.credits <= 0n) throw new RangeError("createQuote: credits must be positive");
  const now = input.now ?? new Date();
  const hours = await readConfig(
    db,
    "pricing.quote_validity_hours",
    z.number().int().positive(),
  );
  const expiresAt = new Date(now.getTime() + hours * 3_600_000);
  const r = await db.query<{ id: string }>(
    `insert into public.quotes (account_id, job_id, reason, credits, expires_at, created_at)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [
      input.accountId,
      input.jobId,
      input.reason,
      input.credits.toString(),
      expiresAt,
      now,
    ],
  );
  const quoteId = r.rows[0]?.id;
  if (quoteId === undefined) throw new Error("createQuote: insert returned no id");
  return { quoteId, expiresAt };
}

export type DecideResult =
  | { readonly status: "accepted" | "declined"; readonly credits: bigint }
  | { readonly status: "expired" }
  | { readonly status: "not_found" }
  | { readonly status: "already_decided"; readonly current: string };

/** Accept or decline, only by the owning account and only before expiry. */
export async function decideQuote(
  pool: Pool,
  input: {
    quoteId: string;
    accountId: string;
    decision: "accept" | "decline";
    now?: Date;
  },
): Promise<DecideResult> {
  const now = input.now ?? new Date();
  return withTransaction(pool, async (tx) => {
    const r = await tx.query<{ status: string; expires_at: Date; credits: string }>(
      `select status, expires_at, credits from public.quotes
       where id = $1 and account_id = $2 for update`,
      [input.quoteId, input.accountId],
    );
    const quote = r.rows[0];
    if (quote === undefined) return { status: "not_found" };
    if (quote.status !== "offered")
      return { status: "already_decided", current: quote.status };
    if (quote.expires_at <= now) {
      await tx.query(
        `update public.quotes set status = 'expired', decided_at = $2 where id = $1`,
        [input.quoteId, now],
      );
      return { status: "expired" };
    }
    const next = input.decision === "accept" ? "accepted" : "declined";
    await tx.query(
      `update public.quotes set status = $2, decided_at = $3 where id = $1`,
      [input.quoteId, next, now],
    );
    return { status: next, credits: BigInt(quote.credits) };
  });
}

/** Worker sweep: mark offered quotes past expiry as expired. */
export async function expireQuotes(db: Queryable, now = new Date()): Promise<number> {
  const r = await db.query(
    `update public.quotes set status = 'expired', decided_at = $1
     where status = 'offered' and expires_at <= $1`,
    [now],
  );
  return r.rowCount ?? 0;
}
