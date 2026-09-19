import type { NumberFormatOptions } from "@magicmis/core/format";
import { currencySymbol } from "@magicmis/core/reporting-conventions";
import { hiddenPeriods } from "@magicmis/jobs";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { z } from "zod";

import { AppFrame } from "@/components/AppFrame";
import { Icon } from "@/components/Icon";
import { Badge, ButtonLink, PageHeader, Panel, type BadgeTone } from "@/components/ui";
import { accountOrRedirect } from "@/lib/account-page";
import { db } from "@/lib/db";
import { CHAT_COOKIE } from "@/lib/prefs";
import { fileRows } from "@/lib/server/files";

import { CompanyFiles } from "./CompanyFiles";
import { ReportingConventions } from "./ReportingConventions";
import { JobRunner } from "./run/JobRunner";
import { Workspace } from "./Workspace";

export const metadata = { title: "Company" };
export const dynamic = "force-dynamic";

const LIFECYCLE: Record<string, { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "positive" },
  grace: { label: "Paused — add credits", tone: "warning" },
  archived: { label: "Archived", tone: "muted" },
  purged: { label: "Deleted", tone: "muted" },
};

/**
 * A company, as one workspace (ADR 0033).
 *
 * Before its first setup the page is the setup itself: drop the files in and build. After it, the
 * page is **the board and the chat and nothing else** (ADR 0047): what is presented, and what it
 * is built with. Everything that is not the board — how the books are kept, the files, the
 * workbooks, what was charged, deleting the company — lives one press away on Files and settings,
 * reached from the header here and from the rail.
 */
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
    number_format: NumberFormatOptions["style"];
    decimals: number;
    currency: string;
    fy_start_month: number;
    date_order: "day_first" | "month_first";
  }>(
    `select name, lifecycle_state, first_setup_at, number_format, decimals, currency,
            fy_start_month, date_order
       from companies where id = $1 and account_id = $2 and deleted_at is null`,
    [id, account.accountId],
  );
  const company = c.rows[0];
  if (company === undefined) notFound();
  const state = LIFECYCLE[company.lifecycle_state] ?? {
    label: company.lifecycle_state,
    tone: "neutral" as BadgeTone,
  };
  const active = company.lifecycle_state === "active";
  const frame = {
    accountId: account.accountId,
    businessName: account.businessName,
    company: { id, name: company.name },
  };

  if (company.first_setup_at === null) {
    const files = await fileRows(pool, { accountId: account.accountId, companyId: id });
    return (
      <AppFrame {...frame}>
        <PageHeader
          title={company.name}
          meta={
            <Badge tone={state.tone} dot>
              {state.label}
            </Badge>
          }
          description="Drop in the files you have, for every month you want in the MIS. We read them, map every ledger and build the first MIS and its dashboard; from there you chat it into shape."
        />
        {active ? (
          <JobRunner companyId={id} mode="setup" businessName={account.businessName} />
        ) : (
          <Panel>
            <p className="text-sm text-neutral-600">
              This company is {state.label.toLowerCase()}. Restore it to set it up.
            </p>
          </Panel>
        )}
        {active ? (
          // Open, not folded away: the financial year has to be right before the first run,
          // and a setting nobody sees is a setting nobody checks.
          <Panel
            className="mt-5"
            title="Reporting conventions"
            icon="settings"
            description="How this company's own books are kept. Check the financial year before you build: it has to match the raw data."
          >
            <ReportingConventions
              companyId={id}
              current={{
                fyStartMonth: company.fy_start_month,
                currency: company.currency,
                numberFormat: company.number_format,
                dateOrder: company.date_order,
              }}
            />
          </Panel>
        ) : null}
        {files.length === 0 ? null : (
          <details
            className="group mt-5 rounded-xl border border-neutral-200/80 bg-surface shadow-sm"
            data-testid="kept-files"
          >
            <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-4 text-[0.875rem] font-semibold text-neutral-900 select-none">
              <span className="flex items-center gap-2">
                <Icon name="lock" size={16} className="text-neutral-400" />
                Files kept for this company ({files.length.toString()})
              </span>
              <Icon
                name="chevron-down"
                size={16}
                className="text-neutral-400 group-open:rotate-180"
              />
            </summary>
            <p className="px-5 pb-3 text-[0.8125rem] text-neutral-500">
              Encrypted under this company&rsquo;s own key, and kept until you delete
              them.
            </p>
            <CompanyFiles files={files} />
          </details>
        )}
      </AppFrame>
    );
  }

  const [hidden, periods, commentaries] = await Promise.all([
    // Months off the dashboard are off the chat's month list too (ADR 0047).
    hiddenPeriods(pool, { accountId: account.accountId, companyId: id }),
    pool.query<{ period: string }>(
      `select distinct period from snapshots where company_id = $1 order by period desc limit 36`,
      [id],
    ),
    pool.query<{ id: string; state: string; period: string | null; created_at: Date }>(
      `select id, state, stage_checkpoints->>'period' as period, created_at from jobs
        where company_id = $1 and account_id = $2 and type = 'commentary'
          and state not in ('draft', 'estimated', 'cancelled')
        order by created_at desc limit 50`,
      [id, account.accountId],
    ),
  ]);
  // Whether the chat was left open or put away, so the first paint is already that layout.
  const chatCookie = (await cookies()).get(CHAT_COOKIE)?.value;
  const chatPreference =
    chatCookie === "open" || chatCookie === "closed" ? chatCookie : null;

  return (
    <AppFrame {...frame} wide>
      <PageHeader
        title={company.name}
        meta={
          <Badge tone={state.tone} dot>
            {state.label}
          </Badge>
        }
        actions={
          <>
            {/* ADR 0046: no print and no export up here; the board is presented from the board.
                ADR 0047: everything that is not the board is one press away, here. */}
            <ButtonLink
              href={`/app/companies/${id}/manage`}
              variant="secondary"
              icon="settings"
              data-testid="open-manage"
            >
              Files and settings
            </ButtonLink>
            {active ? (
              <ButtonLink href={`/app/companies/${id}/run`} icon="upload">
                Add a file
              </ButtonLink>
            ) : null}
          </>
        }
      />

      <Workspace
        companyId={id}
        companyName={company.name}
        money={{
          style: company.number_format,
          decimals: company.decimals,
          negativesInBrackets: true,
        }}
        currencySymbol={currencySymbol(company.currency)}
        periods={periods.rows.map((p) => p.period).filter((p) => !hidden.has(p))}
        commentaries={commentaries.rows.map((j) => ({
          id: j.id,
          state: j.state,
          period: j.period,
          createdAt: j.created_at.toISOString(),
        }))}
        chatPreference={chatPreference}
      />
    </AppFrame>
  );
}
