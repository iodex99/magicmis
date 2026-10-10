import Link from "next/link";

import { CompanyLogo } from "@/components/CompanyLogo";
import { Icon } from "@/components/Icon";
import { Badge, DataTable, Td, Th, Tr } from "@/components/ui";
import { ist, jobState } from "@/lib/job-display";
import { logoUrl } from "@/lib/logo";
import { lastClosedMonth, monthStatus, portfolioOrder } from "@/lib/portfolio-status";
import type { PortfolioFacts } from "@/lib/server/portfolio";
import { periodLabel } from "@magicmis/render-dashboard";

/**
 * Every company at a glance (ADR 0087), for anyone keeping several — clients, subsidiaries, or
 * the businesses a part-time finance director looks after. The ones whose month has closed
 * without their figures come first, furthest behind first, because that is the work for today.
 */
export function PortfolioTable({
  companies,
  facts,
  now,
}: {
  companies: readonly {
    id: string;
    name: string;
    lifecycleState: string;
    firstSetupAt: string | null;
    latestPeriod: string | null;
    logoVersion: string | null;
  }[];
  facts: ReadonlyMap<string, PortfolioFacts>;
  now: Date;
}) {
  const rows = portfolioOrder(
    companies.map((c) => ({
      ...c,
      status: monthStatus(c.firstSetupAt === null ? null : c.latestPeriod, now),
      facts: facts.get(c.id) ?? { lastRun: null, toLook: 0 },
    })),
  );
  const due = rows.filter((r) => r.status.kind === "due").length;
  return (
    <section className="mb-6" data-testid="portfolio">
      <p className="mb-3 text-sm text-neutral-600" data-testid="portfolio-summary">
        {due === 0
          ? `Every company set up has ${periodLabel(lastClosedMonth(now))} in.`
          : `${due.toString()} of ${rows.length.toString()} companies still need ${periodLabel(lastClosedMonth(now))}.`}
      </p>
      <DataTable
        testId="portfolio-table"
        head={
          <>
            <Th>Company</Th>
            <Th>Figures to</Th>
            <Th>This month</Th>
            <Th>Last run</Th>
            <Th numeric>To look at</Th>
            <Th />
          </>
        }
      >
        {rows.map((r) => {
          const setUp = r.firstSetupAt !== null;
          const active = r.lifecycleState === "active";
          return (
            <Tr key={r.id}>
              <Td className="font-medium text-neutral-900">
                <span className="flex items-center gap-2.5">
                  {r.logoVersion === null ? (
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-600">
                      <Icon name="building" size={14} />
                    </span>
                  ) : (
                    <CompanyLogo
                      src={logoUrl(r.id, r.logoVersion) ?? ""}
                      name={r.name}
                      size={28}
                    />
                  )}
                  <Link
                    href={`/app/companies/${r.id}`}
                    className="hover:text-accent-700 hover:underline"
                  >
                    {r.name}
                  </Link>
                </span>
              </Td>
              <Td className="text-neutral-700">
                {r.latestPeriod === null || !setUp ? "—" : periodLabel(r.latestPeriod)}
              </Td>
              <Td>
                {r.status.kind === "due" ? (
                  <Badge tone="warning" dot>
                    {periodLabel(r.status.month)} due
                    {r.status.behind > 1
                      ? ` · ${r.status.behind.toString()} months behind`
                      : ""}
                  </Badge>
                ) : r.status.kind === "up_to_date" ? (
                  <Badge tone="positive" dot>
                    Up to date
                  </Badge>
                ) : (
                  <Badge tone="muted">Not set up</Badge>
                )}
              </Td>
              <Td className="text-[0.8125rem] text-neutral-600">
                {r.facts.lastRun === null
                  ? "—"
                  : `${jobState(r.facts.lastRun.state).label} · ${ist(r.facts.lastRun.at)}`}
              </Td>
              <Td
                numeric
                className={
                  r.facts.toLook > 0 ? "font-medium text-warning" : "text-neutral-400"
                }
              >
                {r.facts.toLook > 0 ? r.facts.toLook.toString() : "—"}
              </Td>
              <Td className="text-right">
                {active ? (
                  <Link
                    href={setUp ? `/app/companies/${r.id}/run` : `/app/companies/${r.id}`}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[0.8125rem] font-medium text-accent-700 hover:bg-accent-50"
                  >
                    <Icon name={setUp ? "upload" : "arrow-right"} size={13} />
                    {setUp ? "Add a file" : "Set up"}
                  </Link>
                ) : null}
              </Td>
            </Tr>
          );
        })}
      </DataTable>
    </section>
  );
}
