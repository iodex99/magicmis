/**
 * Queue an email notification (SPEC §29). The worker sends it through Resend (ADR 0010).
 *
 * The payload holds ids and labels only. SPEC §29: templates contain no financial figures
 * from customer data, and the cheapest way to guarantee that is never to put any in the
 * queue.
 */

import { type Queryable } from "@magicmis/db/tx";

export type NotificationType =
  "security.new_device_login" | "security.password_changed" | "security.email_changed";

export async function enqueueNotification(
  db: Queryable,
  input: {
    accountId: string;
    type: NotificationType;
    payload: Record<string, string | number | boolean | null>;
    /** Makes a retried request enqueue one email, not two. */
    dedupeKey: string;
  },
): Promise<void> {
  await db.query(
    `insert into public.notifications (account_id, type, payload, dedupe_key)
     values ($1, $2, $3, $4)
     on conflict (account_id, dedupe_key) do nothing`,
    [input.accountId, input.type, JSON.stringify(input.payload), input.dedupeKey],
  );
}
