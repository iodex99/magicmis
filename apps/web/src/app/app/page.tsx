import { walletSummary } from "@magicmis/wallet";
import Link from "next/link";

import { AppFrame } from "@/components/AppFrame";
import { MiniBars } from "@/components/Charts";
import { GetStarted } from "@/components/GetStarted";
import { Icon } from "@/components/Icon";
import {
  Badge,
  ButtonLink,
  DataTable,
  EmptyState,
  PageHeader,
  Panel,
  StatCard,
  Td,
  Th,
  Tr,
  type BadgeTone,
} from "@/components/ui";
import { accountOrRedirect } from "@/lib/account-page";
import { formatCredits } from "@/lib/actions";
import { db } from "@/lib/db";
import { listCompanies } from "@/lib/server/companies";
import { accountOverview } from "@/lib/server/overview";

import { defaultConventions } from "@magicmis/core/reporting-conventions";

import { NewCompanyForm } from "./NewCompanyForm";

export const metadata = { title: "Companies" };
export const dynamic = "force-dynamic";

const STATE: Record<string, { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "positive" },
  grace: { label: "Grace period", tone: "warning" },
  archived: { label: "Archived", tone: "muted" },
  purged: { label: "Deleted", tone: "muted" },
};

/** "2026-04" as "April 2026". A period is a month, so the day is never shown. */
function period(value: string | null): string {
  if (value === null) return "—";
  const [year, month] = value.split("-");
  const date = new Date(
    Date.UTC(Number.parseInt(year ?? "", 10), Number.parseInt(month ?? "", 10) - 1, 1),
  );
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });
}

export default async function AppHomePage() {
  const account = await accountOrRedirect("/app");
  const pool = db();
  // The new-company form is pre-filled from where this account is billed, so adding a
  // company stays two fields for almost everyone (ADR 0030). It is a default the reader
  // can see and change, never applied silently.
  const [companies, overview, wallet, billingCountry] = await Promise.all([
    listCompanies(pool, account.accountId),
    accountOverview(pool, account.accountId),
    walletSummary(pool, account.accountId),
    pool
      .query<{ billing_country: string | null }>(
        `select billing_country from public.accounts where id = $1`,
        [account.accountId],
      )
      .then((r) => r.rows[0]?.billing_country ?? null),
  ]);
  const jobsThisMonth = overview.jobsByMonth.at(-1) ?? 0;
  const jobsLastMonth = overview.jobsByMonth.at(-2) ?? 0;

  return (
    <AppFrame accountId={account.accountId} businessName={account.businessName}>
      <PageHeader
        title="Companies"
        description="Every company you keep an MIS for, and what it last produced."
      />

      <GetStarted
        state={{
          hasCompany: companies.length > 0,
          hasCredits: wallet.available > 0n,
          hasRun: overview.workbooks > 0,
        }}
        firstCompanyId={companies[0]?.id ?? null}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active companies"
          value={overview.activeCompanies.toString()}
          icon="building"
          tone="accent"
          hint={
            overview.archivedCompanies === 0
              ? "None archived"
              : `${String(overview.archivedCompanies)} archived`
          }
        />
        <StatCard
          label="Workbooks produced"
          value={overview.workbooks.toString()}
          icon="document"
          hint={
            overview.latestWorkbookAt === null
              ? "Nothing yet"
              : `Latest ${overview.latestWorkbookAt.toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  timeZone: "Asia/Kolkata",
                })}`
          }
        />
        <StatCard
          label="Completed this month"
          value={jobsThisMonth.toString()}
          icon="check-circle"
          delta={
            jobsLastMonth === 0
              ? undefined
              : {
                  direction:
                    jobsThisMonth === jobsLastMonth
                      ? "flat"
                      : jobsThisMonth > jobsLastMonth
                        ? "up"
                        : "down",
                  text: `${String(Math.abs(jobsThisMonth - jobsLastMonth))} vs last month`,
                }
          }
          chart={<MiniBars values={overview.jobsByMonth} />}
        />
        <StatCard
          label="Credits spent, 90 days"
          value={formatCredits(overview.creditsSpent90Days)}
          icon="wallet"
          hint="Across every completed action"
        />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <Panel
          title="Your companies"
          description={
            companies.length === 0
              ? undefined
              : `${String(companies.length)} ${companies.length === 1 ? "company" : "companies"}`
          }
          padding="none"
        >
          {companies.length === 0 ? (
            <EmptyState
              icon="building"
              title="No companies yet"
              testId="app-home"
              action={
                <p className="text-[0.8125rem] text-neutral-500">
                  Use the form beside this list. Creating a company is free.
                </p>
              }
            >
              A company holds one MIS: its mappings, its months, and everything it has
              produced. Add one to start.
            </EmptyState>
          ) : (
            <DataTable
              testId="company-list"
              className="px-2 pb-2"
              head={
                <>
                  <Th>Company</Th>
                  <Th>Status</Th>
                  <Th>Latest period</Th>
                  <Th className="text-right">Action</Th>
                </>
              }
            >
              {companies.map((c) => {
                const state = STATE[c.lifecycleState] ?? {
                  label: c.lifecycleState,
                  tone: "neutral" as BadgeTone,
                };
                return (
                  <Tr key={c.id}>
                    <Td>
                      <Link
                        href={`/app/companies/${c.id}`}
                        className="group flex items-center gap-2.5"
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-50 text-accent-600">
                          <Icon name="building" size={15} />
                        </span>
                        <span>
                          <span className="block font-medium text-neutral-900 group-hover:text-accent-700">
                            {c.name}
                          </span>
                          <span className="block text-[0.75rem] text-neutral-500">
                            {c.firstSetupAt === null ? "Not set up" : "Set up"}
                          </span>
                        </span>
                      </Link>
                    </Td>
                    <Td>
                      <Badge tone={state.tone} dot>
                        {state.label}
                      </Badge>
                    </Td>
                    <Td className="text-neutral-700">{period(c.latestPeriod)}</Td>
                    <Td className="text-right">
                      {c.lifecycleState === "active" ? (
                        <Link
                          href={`/app/companies/${c.id}/run`}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[0.8125rem] font-medium text-accent-700 hover:bg-accent-50"
                        >
                          {c.firstSetupAt === null ? "Set up" : "Refresh"}
                          <Icon name="arrow-right" size={13} />
                        </Link>
                      ) : null}
                    </Td>
                  </Tr>
                );
              })}
            </DataTable>
          )}
        </Panel>

        <Panel
          title="Add a company"
          description="Free. You are charged when you run an action."
          icon="plus"
        >
          <NewCompanyForm defaults={defaultConventions(billingCountry)} />
        </Panel>
      </div>

      <div className="mt-5">
        <Panel padding="sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500">
                <Icon name="file" size={16} />
              </span>
              <div>
                <p className="text-[0.8125rem] font-semibold text-neutral-900">
                  Load this month&rsquo;s exports first
                </p>
                <p className="mt-0.5 text-[0.8125rem] text-neutral-500">
                  Files are read in your browser and never uploaded. Loading them costs
                  nothing.
                </p>
              </div>
            </div>
            <ButtonLink href="/app/data" variant="secondary" size="sm" icon="upload">
              Source files
            </ButtonLink>
          </div>
        </Panel>
      </div>
    </AppFrame>
  );
}
