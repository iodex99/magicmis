import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { AppFrame } from "@/components/AppFrame";
import { Panel } from "@/components/ui";
import { accountOrRedirect } from "@/lib/account-page";
import { ACTION_LABELS, formatCredits } from "@/lib/actions";
import { db } from "@/lib/db";

import { DeleteCompany } from "./DeleteCompany";

export const metadata = { title: "Company" };
export const dynamic = "force-dynamic";

export default async function CompanyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const account = await accountOrRedirect(`/app/companies/${id}`);
  if (!z.uuid().safeParse(id).success) notFound();
  const pool = db();
  const c = await pool.query<{
    name: string;
    lifecycle_state: string;
    first_setup_at: Date | null;
  }>(
    `select name, lifecycle_state, first_setup_at from companies where id = $1 and account_id = $2 and deleted_at is null`,
    [id, account.accountId],
  );
  const company = c.rows[0];
  if (company === undefined) notFound();
  const [jobs, outputs] = await Promise.all([
    pool.query<{
      id: string;
      type: string;
      state: string;
      captured_credits: string | null;
      created_at: Date;
    }>(
      `select id, type, state, captured_credits::text as captured_credits, created_at from jobs where company_id = $1 order by created_at desc limit 50`,
      [id],
    ),
    pool.query<{ id: string; file_name: string | null; created_at: Date }>(
      `select id, file_name, created_at from outputs where company_id = $1 order by created_at desc limit 50`,
      [id],
    ),
  ]);
  return (
    <AppFrame businessName={account.businessName}>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">{company.name}</h1>
        {company.lifecycle_state === "active" ? (
          <nav className="flex gap-4">
            <Link href={`/app/companies/${id}/run`} className="text-accent-700 underline">
              {company.first_setup_at === null ? "Set up MIS" : "Run monthly refresh"}
            </Link>
            {company.first_setup_at === null ? null : (
              <>
                <Link
                  href={`/app/companies/${id}/dashboard`}
                  className="text-accent-700 underline"
                >
                  Dashboard
                </Link>
                <Link
                  href={`/app/companies/${id}/commentary`}
                  className="text-accent-700 underline"
                >
                  Commentary
                </Link>
                <Link
                  href={`/app/companies/${id}/chat`}
                  className="text-accent-700 underline"
                >
                  Chat
                </Link>
              </>
            )}
          </nav>
        ) : null}
      </div>
      <div className="flex flex-col gap-6">
        <Panel title="Workbooks">
          {outputs.rows.length === 0 ? (
            <p className="text-sm text-neutral-700">No workbooks yet.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm" data-testid="company-outputs">
              {outputs.rows.map((o) => (
                <li key={o.id}>
                  <a href={`/api/outputs/${o.id}`} className="text-accent-700 underline">
                    {o.file_name ?? "Workbook"}
                  </a>{" "}
                  <span className="text-neutral-600">
                    {o.created_at.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Jobs">
          {jobs.rows.length === 0 ? (
            <p className="text-sm text-neutral-700">No jobs yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-neutral-600">
                  <th className="py-1">Started (IST)</th>
                  <th className="py-1">Action</th>
                  <th className="py-1">Status</th>
                  <th className="py-1 text-right">Credits charged</th>
                </tr>
              </thead>
              <tbody>
                {jobs.rows.map((j) => (
                  <tr key={j.id} className="border-t border-neutral-100">
                    <td className="py-1">
                      {j.created_at.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                    </td>
                    <td className="py-1">
                      {ACTION_LABELS[j.type as keyof typeof ACTION_LABELS]}
                    </td>
                    <td className="py-1">{j.state.replace(/_/gu, " ")}</td>
                    <td className="py-1 text-right tabular-nums">
                      {j.captured_credits === null
                        ? "—"
                        : formatCredits(j.captured_credits)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title="Delete company">
          <DeleteCompany companyId={id} name={company.name} />
        </Panel>
      </div>
    </AppFrame>
  );
}
