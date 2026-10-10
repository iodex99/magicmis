import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { AppFrame } from "@/components/AppFrame";
import { PageHeader } from "@/components/ui";
import { accountOrRedirect } from "@/lib/account-page";
import { walletSummary } from "@magicmis/wallet";

import { db } from "@/lib/db";
import { yearQuestionOf } from "@/lib/server/run-job";

import { JobRunner } from "./JobRunner";

export const metadata = { title: "Add a file" };
export const dynamic = "force-dynamic";

export default async function RunJobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string; job?: string }>;
}) {
  const { id } = await params;
  const { mode, job } = await searchParams;
  const account = await accountOrRedirect(`/app/companies/${id}/run`);
  if (!z.uuid().safeParse(id).success) notFound();
  const r = await db().query<{
    name: string;
    first_setup_at: Date | null;
    lifecycle_state: string;
    currency: string;
    number_format: string;
    date_order: string;
  }>(
    `select name, first_setup_at, lifecycle_state, currency, number_format,
            date_order
       from companies where id = $1 and account_id = $2 and deleted_at is null`,
    [id, account.accountId],
  );
  const company = r.rows[0];
  if (company === undefined) notFound();
  const asked = job !== undefined && z.uuid().safeParse(job).success ? job : null;
  // A run paused for a quote, opened from its email (ADR 0086): only this account's, only for
  // this company, and only while the quote is still open.
  const pending =
    asked === null
      ? undefined
      : (
          await db().query<{ credits: string; expires_at: Date | null }>(
            `select q.credits::text as credits, q.expires_at
               from jobs j join quotes q on q.id = j.quote_id
              where j.id = $1 and j.account_id = $2 and j.company_id = $3
                and j.state = 'needs_quote' and q.status = 'offered'`,
            [asked, account.accountId, id],
          )
        ).rows[0];
  // Or one waiting on the year question, which may be the company's very first run.
  const waiting =
    asked === null
      ? null
      : yearQuestionOf(
          (
            await db().query<{ stage_checkpoints: Record<string, unknown> }>(
              `select stage_checkpoints from jobs
                where id = $1 and account_id = $2 and company_id = $3 and state = 'awaiting_review'`,
              [asked, account.accountId, id],
            )
          ).rows[0]?.stage_checkpoints ?? {},
        );
  // A company that has never been set up is set up from its workspace (ADR 0033), unless this
  // is the way back to a run of its own that is waiting on something.
  if (
    company.first_setup_at === null &&
    mode !== "setup" &&
    pending === undefined &&
    waiting === null
  )
    redirect(`/app/companies/${id}`);
  const runMode =
    company.first_setup_at === null ? "setup" : mode === "setup" ? "setup" : "refresh";
  return (
    <AppFrame
      accountId={account.accountId}
      businessName={account.businessName}
      company={{ id, name: company.name }}
    >
      <PageHeader
        title={runMode === "setup" ? "Set up the MIS again" : "Add a file"}
        description={
          runMode === "setup"
            ? "Load every month you have. The first run learns the mappings and builds the workbook."
            : "Drop in a file and press one button. It is read, the workbook is built and the dashboard is updated."
        }
        back={{ href: `/app/companies/${id}`, label: company.name }}
      />
      <JobRunner
        companyId={id}
        mode={runMode}
        businessName={account.businessName}
        availableCredits={(
          await walletSummary(db(), account.accountId)
        ).available.toString()}
        pendingQuote={
          pending === undefined || asked === null
            ? null
            : {
                jobId: asked,
                credits: pending.credits,
                expiresAt: pending.expires_at?.toISOString() ?? null,
              }
        }
        pendingYear={
          waiting === null || asked === null ? null : { jobId: asked, question: waiting }
        }
        conventions={{
          currency: company.currency,
          numberFormat: company.number_format,
          dateOrder: company.date_order,
        }}
      />
    </AppFrame>
  );
}
