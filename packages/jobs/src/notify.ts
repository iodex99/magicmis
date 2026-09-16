/**
 * Queues emails (SPEC §29). Payloads carry ids, labels and dates only — never figures from
 * customer data. Delivery and templates live in the worker.
 */

import type { Queryable } from "@magicmis/db/tx";

/**
 * The notices this package queues.
 *
 * It is not the whole catalogue: `packages/accounts` owns the `security.*` sign-in notices
 * and `packages/wallet` inserts `billing.lot_expiry_notice` in SQL. The list that must be
 * complete is `TEMPLATE_TYPES` in `apps/worker/src/templates.ts`, which the worker's own
 * test pins to the rendered templates exactly — a type queued with no template there is
 * never delivered.
 */
export type NotificationType =
  | "job.awaiting_review"
  | "job.review_expiring"
  | "job.completed"
  | "job.failed"
  | "job.quote_offered"
  | "lifecycle.grace"
  | "lifecycle.archive_notice"
  | "lifecycle.archived"
  | "lifecycle.purge_notice"
  | "lifecycle.purged"
  | "billing.memory_fee_debited"
  | "billing.memory_fee_failed"
  | "billing.low_balance_before_fee"
  | "reminder.monthly_refresh"
  | "security.break_glass"
  | "security.break_glass_viewed"
  | "account.deletion_scheduled"
  | "account.export_ready";

export async function queueNotification(
  db: Queryable,
  input: {
    accountId: string;
    type: NotificationType;
    payload: Record<string, string | number | null>;
    dedupeKey: string;
  },
): Promise<boolean> {
  const r = await db.query(
    `insert into public.notifications (account_id, type, payload, dedupe_key)
     values ($1, $2, $3, $4) on conflict (account_id, dedupe_key) do nothing`,
    [input.accountId, input.type, JSON.stringify(input.payload), input.dedupeKey],
  );
  return (r.rowCount ?? 0) > 0;
}
