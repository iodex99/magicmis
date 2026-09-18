import { walletSummary } from "@magicmis/wallet";
import Link from "next/link";

import { AppFrame } from "@/components/AppFrame";
import { MiniBars } from "@/components/Charts";
import { GetStarted } from "@/components/GetStarted";
import { Icon } from "@/components/Icon";
import { Badge, PageHeader, StatCard, type BadgeTone } from "@/components/ui";
import { accountOrRedirect } from "@/lib/account-page";
import { PRODUCT_NAME } from "@/lib/brand";
import { formatCredits } from "@/lib/actions";
import { db } from "@/lib/db";
import { listCompanies } from "@/lib/server/companies";
import { accountOverview } from "@/lib/server/overview";

import { defaultConventions } from "@magicmis/core/reporting-conventions";

import { AddCompany } from "./AddCompany";

export const metadata = { title: "Companies" };
export const dynamic = "force-dynamic";

const STATE: Record<string, { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "positive" },
  grace: { label: "Paused — add credits", tone: "warning" },
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
  const conventions = defaultConventions(billingCountry);
  const jobsThisMonth = overview.jobsByMonth.at(-1) ?? 0;
  const jobsLastMonth = overview.jobsByMonth.at(-2) ?? 0;

  return (
    <AppFrame accountId={account.accountId} businessName={account.businessName}>
      {companies.length === 0 ? (
        <>
          <div className="mb-6">
            <h1 className="display text-[1.75rem] leading-tight font-semibold text-neutral-900">
              Welcome to {PRODUCT_NAME}
            </h1>
          </div>
          <div data-testid="app-home">
            <AddCompany defaults={conventions} startOpen />
          </div>
          {wallet.available > 0n ? null : (
            <p className="mt-4 text-[0.8125rem] text-neutral-500">
              Actions are paid from prepaid credits.{" "}
              <Link
                href="/wallet"
                className="font-medium text-accent-700 hover:underline"
              >
                Add credits
              </Link>{" "}
              whenever you are ready.
            </p>
          )}
        </>
      ) : (
        <>
          <PageHeader
            title="Companies"
            description="Open a company to see its dashboard, ask about its figures or add a month."
          />

          <GetStarted
            state={{
              hasCompany: true,
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

          <ul
            className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3"
            data-testid="company-list"
          >
            {companies.map((c, i) => {
              const state = STATE[c.lifecycleState] ?? {
                label: c.lifecycleState,
                tone: "neutral" as BadgeTone,
              };
              const setUp = c.firstSetupAt !== null;
              return (
                <li
                  key={c.id}
                  className="lift rise group relative flex flex-col rounded-2xl border border-neutral-200/80 bg-surface p-5 shadow-sm hover:border-accent-200"
                  style={{ "--i": i.toString() } as React.CSSProperties}
                >
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-accent-600">
                      <Icon name="building" size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/app/companies/${c.id}`}
                        className="block truncate text-[1rem] font-semibold text-neutral-900 after:absolute after:inset-0 group-hover:text-accent-700"
                      >
                        {c.name}
                      </Link>
                      <p className="mt-0.5 text-[0.8125rem] text-neutral-500">
                        {setUp
                          ? `Figures to ${period(c.latestPeriod)}`
                          : "Not set up yet"}
                      </p>
                    </div>
                    <Badge tone={state.tone} dot>
                      {state.label}
                    </Badge>
                  </div>
                  <div className="mt-5 flex items-center justify-between border-t border-neutral-100 pt-3.5 text-[0.8125rem]">
                    <span className="font-medium text-accent-700">
                      {setUp ? "Open dashboard" : "Finish setting up"}
                    </span>
                    {setUp && c.lifecycleState === "active" ? (
                      <Link
                        href={`/app/companies/${c.id}/run`}
                        className="relative z-10 inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
                      >
                        <Icon name="upload" size={13} />
                        Add a month
                      </Link>
                    ) : (
                      <Icon
                        name="arrow-right"
                        size={15}
                        className="text-neutral-400 transition-transform group-hover:translate-x-0.5 group-hover:text-accent-600"
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <AddCompany defaults={conventions} startOpen={false} />
        </>
      )}
    </AppFrame>
  );
}
