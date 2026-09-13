import type { NumberFormatOptions } from "@magicmis/core/format";
import { metricLabel } from "@magicmis/render-dashboard";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { AppFrame } from "@/components/AppFrame";
import { accountOrRedirect } from "@/lib/account-page";
import { db } from "@/lib/db";

import { ChatClient } from "./ChatClient";

export const metadata = { title: "Chat" };
export const dynamic = "force-dynamic";

export default async function ChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ investigate?: string; period?: string }>;
}) {
  const { id } = await params;
  const { investigate, period } = await searchParams;
  const account = await accountOrRedirect(`/app/companies/${id}/chat`);
  if (!z.uuid().safeParse(id).success) notFound();
  const r = await db().query<{ name: string; number_format: NumberFormatOptions["style"]; decimals: number }>(
    `select name, number_format, decimals from companies where id = $1 and account_id = $2 and deleted_at is null`,
    [id, account.accountId],
  );
  const company = r.rows[0];
  if (company === undefined) notFound();
  // An Investigate button opens a Deep question about that metric's movement, priced as chat_deep.
  const metric = investigate !== undefined && /^[a-z_]{1,60}(\.[a-z_]{1,20})?$/u.test(investigate) ? investigate : null;
  const month = period !== undefined && /^\d{4}-\d{2}$/u.test(period) ? period : null;
  const prefill =
    metric === null
      ? null
      : {
          type: "investigate" as const,
          text: `Why did ${metricLabel(metric.split(".")[0] ?? metric)} move${month === null ? "" : ` in ${month}`}? Which ledgers drove the change?`,
        };
  return (
    <AppFrame businessName={account.businessName}>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">{company.name} — Chat</h1>
        <Link href={`/app/companies/${id}`} className="text-accent-700 underline">
          Back to company
        </Link>
      </div>
      <ChatClient
        companyId={id}
        money={{ style: company.number_format, decimals: company.decimals, negativesInBrackets: true }}
        prefill={prefill}
      />
    </AppFrame>
  );
}
