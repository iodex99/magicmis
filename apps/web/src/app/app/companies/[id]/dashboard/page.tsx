import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { AppFrame } from "@/components/AppFrame";
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
    <AppFrame businessName={account.businessName}>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">
          {company.name} — Dashboard
        </h1>
        <Link href={`/app/companies/${id}`} className="text-accent-700 underline">
          Back to company
        </Link>
      </div>
      <DashboardClient companyId={id} />
    </AppFrame>
  );
}
