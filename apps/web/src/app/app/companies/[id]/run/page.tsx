import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { AppFrame } from "@/components/AppFrame";
import { PageHeader } from "@/components/ui";
import { accountOrRedirect } from "@/lib/account-page";
import { walletSummary } from "@magicmis/wallet";

import { db } from "@/lib/db";

import { ClosedCompany } from "./ClosedCompany";
import { JobRunner } from "./JobRunner";
import { closedState, pendingRun, runPrices } from "./run-context";

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
  const pool = db();
  const r = await pool.query<{
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
  // The run already there, if there is one (ADR 0091): working, paused for a quote, or waiting on
  // the year question. The one an email asked about comes first; without `?job=` it is the
  // company's newest, so a reload or a second visit finds it rather than starting another.
  const pending = await pendingRun(pool, {
    accountId: account.accountId,
    companyId: id,
    asked,
  });
  const waiting =
    pending.live !== null || pending.quote !== null || pending.year !== null;
  // A company that has never been set up is set up from its workspace (ADR 0033), unless this
  // is the way back to a run of its own that is working or waiting on something.
  if (company.first_setup_at === null && mode !== "setup" && !waiting)
    redirect(`/app/companies/${id}`);
  const runMode =
    company.first_setup_at === null ? "setup" : mode === "setup" ? "setup" : "refresh";
  const [wallet, prices, closed] = await Promise.all([
    walletSummary(pool, account.accountId),
    runPrices(pool, { accountId: account.accountId, companyId: id, mode: runMode }),
    closedState(pool, {
      accountId: account.accountId,
      companyId: id,
      lifecycleState: company.lifecycle_state,
    }),
  ]);
  return (
    <AppFrame
      accountId={account.accountId}
      businessName={account.businessName}
      company={{ id, name: company.name }}
    >
      <PageHeader
        title={
          runMode === "refresh"
            ? "Add a file"
            : company.first_setup_at === null
              ? `Set up ${company.name}`
              : "Set up the MIS again"
        }
        description={
          runMode === "setup"
            ? "Load every month you have. The first run learns the mappings and builds the workbook and its dashboard."
            : "Drop in a file and press one button. It is read, the workbook is built and the dashboard is updated."
        }
        back={{ href: `/app/companies/${id}`, label: company.name }}
      />
      {/* Said before the drop zone, not after the uploads (ADR 0091). A run already working is
          still followed: it was started while the company was open. */}
      {closed !== null && pending.live === null ? (
        <ClosedCompany
          companyId={id}
          closed={closed}
          businessName={account.businessName}
        />
      ) : (
        <JobRunner
          companyId={id}
          mode={runMode}
          businessName={account.businessName}
          availableCredits={wallet.available.toString()}
          pendingQuote={pending.quote}
          pendingYear={pending.year}
          liveRun={pending.live}
          prices={prices}
          conventions={{
            currency: company.currency,
            numberFormat: company.number_format,
            dateOrder: company.date_order,
          }}
        />
      )}
    </AppFrame>
  );
}
