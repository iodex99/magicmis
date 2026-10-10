import "server-only";

import { renderNotification } from "@magicmis/jobs";
import type { Pool } from "pg";

/**
 * The in-app inbox (ADR 0087): the notices the worker emails, shown in the app as well, newest
 * first. Each is rendered by the same template its email is (`notice-templates.ts`), so the inbox
 * says what the email said and sends its reader to the same page.
 */

export interface InboxItem {
  readonly id: string;
  readonly title: string;
  /** The notice's first paragraph, so two notices with one title can still be told apart (ADR 0091). */
  readonly summary: string;
  readonly link: { readonly label: string; readonly path: string } | null;
  readonly at: Date;
  readonly read: boolean;
}

const LIMIT = 50;

export async function inbox(pool: Pool, accountId: string): Promise<InboxItem[]> {
  const r = await pool.query<{
    id: string;
    type: string;
    payload: unknown;
    created_at: Date;
    read_at: Date | null;
  }>(
    `select id, type, payload, created_at, read_at from public.notifications
      where account_id = $1 and status <> 'suppressed'
      order by created_at desc limit $2`,
    [accountId, LIMIT],
  );
  return r.rows.flatMap((row) => {
    // The app's own address is irrelevant here: only the title and the path are used.
    const rendered = renderNotification(row.type, row.payload, {
      appUrl: "https://app.invalid",
    });
    return rendered === null
      ? []
      : [
          {
            id: row.id,
            title: rendered.title,
            summary: rendered.summary,
            link: rendered.link ?? null,
            at: row.created_at,
            read: row.read_at !== null,
          },
        ];
  });
}

/** How many notices are unread, for the rail; counted over what the inbox would show. */
export async function unreadCount(pool: Pool, accountId: string): Promise<number> {
  const r = await pool.query<{ n: number }>(
    `select count(*)::int as n from (
       select read_at from public.notifications
        where account_id = $1 and status <> 'suppressed'
        order by created_at desc limit $2) recent
      where read_at is null`,
    [accountId, LIMIT],
  );
  return r.rows[0]?.n ?? 0;
}

/**
 * Marks read what the inbox showed: every notice up to the newest on screen. One that arrived
 * after the page was drawn — a sign-in, say — stays unread, because nobody has seen it.
 */
export async function markRead(pool: Pool, accountId: string, upTo: Date): Promise<void> {
  await pool.query(
    `update public.notifications set read_at = now()
      where account_id = $1 and read_at is null
        -- To the millisecond, as the page received it: the row keeps microseconds.
        and date_trunc('milliseconds', created_at) <= $2`,
    [accountId, upTo],
  );
}
