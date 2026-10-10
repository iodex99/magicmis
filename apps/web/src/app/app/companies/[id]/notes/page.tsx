import { hiddenPeriods } from "@magicmis/jobs";
import { notFound } from "next/navigation";
import { z } from "zod";

import { accountOrRedirect } from "@/lib/account-page";
import { db } from "@/lib/db";

import { PresenterNotes } from "./PresenterNotes";

export const metadata = { title: "Presenter notes" };
export const dynamic = "force-dynamic";

/**
 * Presenter notes (ADR 0087): what the assistant wrote about each month — where to act, and the
 * commentary — on the presenter's own screen while the board is presented on the room's. It
 * reads what was already written and paid for; it writes nothing, so it charges nothing. A month
 * with nothing written says so, and the place to ask for it is the board.
 */
export default async function NotesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { id } = await params;
  const { period } = await searchParams;
  const account = await accountOrRedirect(`/app/companies/${id}/notes`);
  if (!z.uuid().safeParse(id).success) notFound();
  const pool = db();
  const company = await pool.query<{ name: string }>(
    `select name from companies where id = $1 and account_id = $2 and deleted_at is null`,
    [id, account.accountId],
  );
  const name = company.rows[0]?.name;
  if (name === undefined) notFound();
  // The newest completed piece of each kind for each month.
  const [written, hidden] = await Promise.all([
    pool.query<{ id: string; type: string; period: string }>(
      `select distinct on (type, stage_checkpoints->>'period')
              id, type, stage_checkpoints->>'period' as period
         from jobs
        where account_id = $1 and company_id = $2 and state = 'completed'
          and type in ('commentary', 'board_actions')
          and stage_checkpoints ? 'period'
        order by type, stage_checkpoints->>'period', created_at desc`,
      [account.accountId, id],
    ),
    // A month off the board is off the notes too (ADR 0048): its writing will not open, and
    // opening on it showed an error where the presenter expected their notes (ADR 0091).
    hiddenPeriods(pool, { accountId: account.accountId, companyId: id }),
  ]);
  const byMonth: Record<string, { commentary?: string; actions?: string }> = {};
  for (const w of written.rows) {
    const entry = (byMonth[w.period] ??= {});
    if (w.type === "commentary") entry.commentary = w.id;
    else entry.actions = w.id;
  }
  const months = Object.keys(byMonth)
    .filter((m) => !hidden.has(m))
    .sort()
    .reverse();
  const first =
    period !== undefined && /^\d{4}-(0[1-9]|1[0-2])$/u.test(period) && !hidden.has(period)
      ? period
      : (months[0] ?? null);
  return (
    <PresenterNotes
      companyId={id}
      companyName={name}
      initialPeriod={first}
      months={months}
      written={byMonth}
    />
  );
}
