import { notFound } from "next/navigation";
import { z } from "zod";

import { AppFrame } from "@/components/AppFrame";
import { accountOrRedirect } from "@/lib/account-page";
import { db } from "@/lib/db";

import { JobRunner } from "./JobRunner";

export const metadata = { title: "Run job" };
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
  const runMode =
    company.first_setup_at === null ? "setup" : mode === "setup" ? "setup" : "refresh";
  return (
    <AppFrame businessName={account.businessName}>
      <h1 className="mb-6 text-xl font-semibold text-neutral-900">
        {company.name} — {runMode === "setup" ? "Set up MIS" : "Monthly refresh"}
      </h1>
      <JobRunner companyId={id} mode={runMode} />
    </AppFrame>
  );
}
