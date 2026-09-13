import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { AppFrame } from "@/components/AppFrame";
import { accountOrRedirect } from "@/lib/account-page";
import { db } from "@/lib/db";

import { CommentaryClient } from "./CommentaryClient";

export const metadata = { title: "Commentary" };
export const dynamic = "force-dynamic";

export default async function CommentaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const account = await accountOrRedirect(`/app/companies/${id}/commentary`);
  if (!z.uuid().safeParse(id).success) notFound();
  const pool = db();
  const r = await pool.query<{ name: string }>(
    `select name from companies where id = $1 and account_id = $2 and deleted_at is null`,
    [id, account.accountId],
  );
  const company = r.rows[0];
  if (company === undefined) notFound();
  const [periods, jobs] = await Promise.all([
    pool.query<{ period: string }>(
      `select distinct period from snapshots where company_id = $1 order by period desc limit 24`,
      [id],
    ),
    pool.query<{ id: string; state: string; period: string | null; created_at: Date }>(
      `select id, state, stage_checkpoints->>'period' as period, created_at from jobs
       where company_id = $1 and account_id = $2 and type = 'commentary' and state not in ('draft', 'estimated')
       order by created_at desc limit 50`,
      [id, account.accountId],
    ),
  ]);
  return (
    <AppFrame businessName={account.businessName}>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">{company.name} — Commentary</h1>
        <Link href={`/app/companies/${id}`} className="text-accent-700 underline">
          Back to company
        </Link>
      </div>
      <CommentaryClient
        companyId={id}
        periods={periods.rows.map((p) => p.period)}
        jobs={jobs.rows.map((j) => ({
          id: j.id,
          state: j.state,
          period: j.period,
          createdAt: j.created_at.toISOString(),
        }))}
      />
    </AppFrame>
  );
}
