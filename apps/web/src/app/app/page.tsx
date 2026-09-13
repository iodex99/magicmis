import Link from "next/link";

import { AppFrame } from "@/components/AppFrame";
import { Panel } from "@/components/ui";
import { accountOrRedirect } from "@/lib/account-page";
import { db } from "@/lib/db";
import { listCompanies } from "@/lib/server/companies";

import { NewCompanyForm } from "./NewCompanyForm";

export const metadata = { title: "Companies" };
export const dynamic = "force-dynamic";

const STATE_LABEL: Record<string, string> = {
  active: "Active",
  grace: "Grace period",
  archived: "Archived",
  purged: "Deleted",
};

export default async function AppHomePage() {
  const account = await accountOrRedirect("/app");
  const companies = await listCompanies(db(), account.accountId);
  return (
    <AppFrame businessName={account.businessName}>
      <h1 className="mb-6 text-xl font-semibold text-neutral-900">Companies</h1>
      <div className="flex flex-col gap-6">
        <Panel>
          {companies.length === 0 ? (
            <p className="text-sm text-neutral-700" data-testid="app-home">
              No companies yet. Add one below; creating a company is free.
            </p>
          ) : (
            <table className="w-full text-sm" data-testid="company-list">
              <thead>
                <tr className="text-left text-xs text-neutral-600">
                  <th className="py-1">Company</th>
                  <th className="py-1">Status</th>
                  <th className="py-1">Latest period</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.id} className="border-t border-neutral-100">
                    <td className="py-2">
                      <Link
                        href={`/app/companies/${c.id}`}
                        className="text-accent-700 underline"
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td className="py-2">
                      {STATE_LABEL[c.lifecycleState] ?? c.lifecycleState}
                    </td>
                    <td className="py-2 tabular-nums">{c.latestPeriod ?? "—"}</td>
                    <td className="py-2 text-right">
                      {c.lifecycleState === "active" ? (
                        <Link
                          href={`/app/companies/${c.id}/run`}
                          className="text-accent-700 underline"
                        >
                          {c.firstSetupAt === null ? "Set up" : "Refresh"}
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title="Add a company">
          <NewCompanyForm />
        </Panel>
      </div>
    </AppFrame>
  );
}
