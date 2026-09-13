/**
 * Deliver queued notifications (SPEC §29, ADR 0010).
 *
 * Each row is claimed with `FOR UPDATE SKIP LOCKED` in its own transaction, so two worker
 * instances never pick the same row, and the send carries `idempotencyKey =
 * notification:<id>` so a crash between send and commit cannot deliver twice within the
 * provider's 24-hour window. Failures back off exponentially up to a configured attempt cap.
 */

import { loadInvoice, renderInvoicePdf } from "@magicmis/billing";
import { readConfig } from "@magicmis/db/config";
import { withTransaction } from "@magicmis/db/tx";
import type { Pool } from "pg";
import { z } from "zod";

import type { MailSender } from "./mail";
import {
  CLOSED_ACCOUNT_TYPES,
  renderNotification,
  TEMPLATE_TYPES,
  type TemplateContext,
} from "./templates";

export interface DeliveryStats {
  sent: number;
  failed: number;
  retried: number;
  suppressed: number;
}

export async function deliverNotifications(
  pool: Pool,
  sender: MailSender,
  ctx: TemplateContext,
  now = new Date(),
): Promise<DeliveryStats> {
  const maxAttempts = await readConfig(
    pool,
    "notifications.max_attempts",
    z.number().int().positive(),
  );
  const baseSeconds = await readConfig(
    pool,
    "notifications.retry_base_seconds",
    z.number().int().positive(),
  );
  const batch = await readConfig(
    pool,
    "notifications.batch_size",
    z.number().int().positive(),
  );
  const stats: DeliveryStats = { sent: 0, failed: 0, retried: 0, suppressed: 0 };

  for (let i = 0; i < batch; i += 1) {
    const handled = await withTransaction(pool, async (tx) => {
      const r = await tx.query<{
        id: string;
        account_id: string;
        type: string;
        payload: unknown;
        attempts: number;
        email: string;
        account_status: string;
      }>(
        `select n.id, n.account_id, n.type, n.payload, n.attempts, a.email, a.status as account_status
         from public.notifications n join public.accounts a on a.id = n.account_id
         where n.status = 'queued' and n.next_attempt_at <= $1
         order by n.next_attempt_at, n.created_at
         limit 1
         for update of n skip locked`,
        [now],
      );
      const row = r.rows[0];
      if (row === undefined) return false;

      // A closed account still receives its deletion notice and any break-glass notice, until purged.
      const blocked =
        row.account_status === "deleted" &&
        !(CLOSED_ACCOUNT_TYPES.has(row.type) && !row.email.endsWith("@invalid"));
      const rendered = blocked ? null : renderNotification(row.type, row.payload, ctx);
      if (rendered === null && !blocked && TEMPLATE_TYPES.has(row.type)) {
        // A known type with a payload its template rejects: fail loudly, never suppress silently.
        await tx.query(
          `update public.notifications set status = 'failed', last_error = $2 where id = $1`,
          [row.id, `payload rejected by the ${row.type} template`],
        );
        stats.failed += 1;
        return true;
      }
      if (rendered === null) {
        await tx.query(
          `update public.notifications set status = 'suppressed', last_error = $2 where id = $1`,
          [row.id, blocked ? "account deleted" : `no template for ${row.type}`],
        );
        stats.suppressed += 1;
        return true;
      }

      let attachments: { filename: string; content: Buffer }[] | undefined;
      if (rendered.attachInvoiceId !== undefined) {
        const invoice = await loadInvoice(tx, {
          invoiceId: rendered.attachInvoiceId,
          accountId: row.account_id,
        });
        if (invoice === null) {
          await tx.query(
            `update public.notifications set status = 'suppressed', last_error = 'invoice not found' where id = $1`,
            [row.id],
          );
          stats.suppressed += 1;
          return true;
        }
        attachments = [
          {
            filename: `${invoice.number.replaceAll("/", "-")}.pdf`,
            content: Buffer.from(await renderInvoicePdf(invoice)),
          },
        ];
      }

      const result = await sender
        .send({
          to: row.email,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
          idempotencyKey: `notification:${row.id}`,
          ...(attachments === undefined ? {} : { attachments }),
        })
        .catch((error: unknown) => ({
          ok: false as const,
          error: error instanceof Error ? error.message : "send threw",
        }));

      const attempts = row.attempts + 1;
      if (result.ok) {
        await tx.query(
          `update public.notifications set status = 'sent', sent_at = $2, attempts = $3, provider_message_id = $4, last_error = null
           where id = $1`,
          [row.id, now, attempts, result.id],
        );
        stats.sent += 1;
      } else if (attempts >= maxAttempts) {
        await tx.query(
          `update public.notifications set status = 'failed', attempts = $2, last_error = $3 where id = $1`,
          [row.id, attempts, result.error.slice(0, 500)],
        );
        stats.failed += 1;
      } else {
        const delayMs = baseSeconds * 1000 * 2 ** (attempts - 1);
        await tx.query(
          `update public.notifications set attempts = $2, last_error = $3, next_attempt_at = $4 where id = $1`,
          [
            row.id,
            attempts,
            result.error.slice(0, 500),
            new Date(now.getTime() + delayMs),
          ],
        );
        stats.retried += 1;
      }
      return true;
    });
    if (!handled) break;
  }
  return stats;
}
