import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { AppFrame } from "@/components/AppFrame";
import { PageHeader } from "@/components/ui";
import { accountOrRedirect } from "@/lib/account-page";
import { db } from "@/lib/db";

import { JobRunner } from "./JobRunner";

export const metadata = { title: "Add a file" };
export const dynamic = "force-dynamic";

export default async function RunJobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const { id } = await params;
  const { mode } = await searchParams;
  const account = await accountOrRedirect(`/app/companies/${id}/run`);
  if (!z.uuid().safeParse(id).success) notFound();
  const r = await db().query<{
    name: string;
    first_setup_at: Date | null;
    lifecycle_state: string;
  }>(
    `select name, first_setup_at, lifecycle_state from companies where id = $1 and account_id = $2 and deleted_at is null`,
    [id, account.accountId],
  );
  const company = r.rows[0];
  if (company === undefined) notFound();
  // A company that has never been set up is set up from its workspace (ADR 0033).
  if (company.first_setup_at === null && mode !== "setup")
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
      <JobRunner companyId={id} mode={runMode} businessName={account.businessName} />
    </AppFrame>
  );
}
