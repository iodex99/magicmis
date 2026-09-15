import { notFound } from "next/navigation";
import { z } from "zod";

import { AppFrame } from "@/components/AppFrame";
import { PageHeader } from "@/components/ui";
import { accountOrRedirect } from "@/lib/account-page";
import { db } from "@/lib/db";

import { DashboardClient } from "./DashboardClient";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const account = await accountOrRedirect(`/app/companies/${id}/dashboard`);
  if (!z.uuid().safeParse(id).success) notFound();
  const r = await db().query<{ name: string }>(
    `select name from companies where id = $1 and account_id = $2 and deleted_at is null`,
    [id, account.accountId],
  );
  const company = r.rows[0];
  if (company === undefined) notFound();
  return (
    <AppFrame
      accountId={account.accountId}
      businessName={account.businessName}
      company={{ id, name: company.name }}
    >
      <PageHeader
        title="Dashboard"
        description={`Charts and KPIs for ${company.name}. Every figure is computed by the engine — click one to see how.`}
        back={{ href: `/app/companies/${id}`, label: company.name }}
      />
      <DashboardClient companyId={id} />
    </AppFrame>
  );
}
