import type { NumberFormatOptions } from "@magicmis/core/format";
import { currencySymbol } from "@magicmis/core/reporting-conventions";
import { uploadLimits } from "@magicmis/jobs";
import { notFound } from "next/navigation";
import { z } from "zod";

import { AppFrame } from "@/components/AppFrame";
import { Icon } from "@/components/Icon";
import {
  Badge,
  ButtonLink,
  DataTable,
  EmptyState,
  PageHeader,
  Panel,
  Td,
  Th,
  Tr,
  type BadgeTone,
} from "@/components/ui";
import { accountOrRedirect } from "@/lib/account-page";
import { ACTION_LABELS, formatCredits } from "@/lib/actions";
import { db } from "@/lib/db";

import { PrintButton } from "@/components/PrintButton";

import { CompanyFiles } from "./CompanyFiles";
import { ReportingConventions } from "./ReportingConventions";
import { DeleteCompany } from "./DeleteCompany";
import { JobRunner } from "./run/JobRunner";
import { Workspace } from "./Workspace";

export const metadata = { title: "Company" };
export const dynamic = "force-dynamic";

const LIFECYCLE: Record<string, { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "positive" },
  grace: { label: "Grace period", tone: "warning" },
  archived: { label: "Archived", tone: "muted" },
  purged: { label: "Deleted", tone: "muted" },
};

/** Job states as words a customer can act on (SPEC §32: no raw identifiers in the UI). */
const JOB_STATE: Record<string, { label: string; tone: BadgeTone }> = {
  completed: { label: "Completed", tone: "positive" },
  failed: { label: "Failed", tone: "negative" },
  cancelled: { label: "Cancelled", tone: "muted" },
  paused: { label: "Paused", tone: "warning" },
  awaiting_confirmation: { label: "Awaiting confirmation", tone: "warning" },
  awaiting_review: { label: "Awaiting review", tone: "warning" },
  running: { label: "Running", tone: "accent" },
  queued: { label: "Queued", tone: "accent" },
  expired: { label: "Expired", tone: "muted" },
  needs_quote: { label: "Needs a quote", tone: "warning" },
  quote_accepted: { label: "Quote accepted", tone: "accent" },
  failed_data: { label: "Failed — check the data", tone: "negative" },
  failed_platform: { label: "Failed — our fault", tone: "negative" },
};

const ist = (d: Date) =>
  d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

type Pool = ReturnType<typeof db>;

/** What this company still keeps on our servers, for the list with its delete buttons. */
async function keptFiles(pool: Pool, companyId: string, accountId: string) {
  const [rows, limits] = await Promise.all([
    pool.query<{
      id: string;
      file_name: string;
      byte_size: string;
      status: string;
      created_at: Date;
      expires_at: Date;
    }>(
      `select id, file_name, byte_size::text as byte_size, status, created_at, expires_at
         from source_uploads
        where company_id = $1 and account_id = $2 and deleted_at is null
        order by created_at desc limit 500`,
      [companyId, accountId],
    ),
    uploadLimits(pool),
  ]);
  return {
    retentionDays: limits.retentionDays,
    files: rows.rows.map((r) => ({
      id: r.id,
      name: r.file_name,
      size: Number.parseInt(r.byte_size, 10),
      usable: r.status === "ready",
      uploadedAt: r.created_at.toISOString(),
      deletesAt: r.expires_at.toISOString(),
    })),
  };
}

/**
 * A company, as one workspace (ADR 0033).
 *
 * Before its first setup the page is the setup itself: drop the trial balances and build. After
 * it, the page is the dashboard with the assistant beside it — questions, deeper analysis, layout
 * changes and the month's commentary in one conversation — and the company's workbooks, kept
 * files and history below. There are no separate chat, commentary or dashboard tabs.
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
  const conventions = {
    fyStartMonth: company.fy_start_month,
    currency: company.currency,
    numberFormat: company.number_format,
    dateOrder: company.date_order,
  };
  const frame = {
    accountId: account.accountId,
    businessName: account.businessName,
    company: { id, name: company.name },
  };

  if (company.first_setup_at === null) {
    const kept = await keptFiles(pool, id, account.accountId);
    return (
      <AppFrame {...frame}>
        <PageHeader
          title={company.name}
          meta={
            <Badge tone={state.tone} dot>
              {state.label}
            </Badge>
          }
          description="Drop in the trial balances you have — every month you want in the MIS. We read them, map every ledger and build the workbook, then this becomes the company's dashboard and assistant."
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
          <details className="group mt-5 rounded-xl border border-neutral-200/80 bg-surface shadow-sm">
            <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-4 text-[0.875rem] font-semibold text-neutral-900 select-none">
              <span className="flex items-center gap-2">
                <Icon name="settings" size={16} className="text-neutral-400" />
                Reporting conventions
              </span>
              <span className="flex items-center gap-2 text-[0.8125rem] font-normal text-neutral-500">
                {company.currency} · year starts{" "}
                {
                  [
                    "January",
                    "February",
                    "March",
                    "April",
                    "May",
                    "June",
                    "July",
                    "August",
                    "September",
                    "October",
                    "November",
                    "December",
                  ][company.fy_start_month - 1]
                }
                <Icon
                  name="chevron-down"
                  size={16}
                  className="text-neutral-400 group-open:rotate-180"
                />
              </span>
            </summary>
            <div className="px-5 pb-5">
              <ReportingConventions companyId={id} current={conventions} />
            </div>
          </details>
        ) : null}
        {kept.files.length === 0 ? null : (
          <details
            className="group mt-5 rounded-xl border border-neutral-200/80 bg-surface shadow-sm"
            data-testid="kept-files"
          >
            <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-4 text-[0.875rem] font-semibold text-neutral-900 select-none">
              <span className="flex items-center gap-2">
                <Icon name="lock" size={16} className="text-neutral-400" />
                Files kept for this company ({kept.files.length.toString()})
              </span>
              <Icon
                name="chevron-down"
                size={16}
                className="text-neutral-400 group-open:rotate-180"
              />
            </summary>
            <p className="px-5 pb-3 text-[0.8125rem] text-neutral-500">
              Encrypted, and deleted automatically {kept.retentionDays.toString()} days
              after upload.
            </p>
            <CompanyFiles files={kept.files} />
          </details>
        )}
      </AppFrame>
    );
  }

  const [jobs, outputs, periods, commentaries, kept] = await Promise.all([
    pool.query<{
      id: string;
      type: string;
      state: string;
      captured_credits: string | null;
      created_at: Date;
    }>(
      // What the account did, not what it looked at: an abandoned start carries no charge
      // and is not part of this company's history.
      `select id, type, state, captured_credits::text as captured_credits, created_at
          from jobs
         where company_id = $1
           and state not in ('draft', 'estimated')
           and not (state = 'cancelled' and coalesce(captured_credits, 0) = 0)
         order by created_at desc limit 50`,
      [id],
    ),
    pool.query<{ id: string; file_name: string | null; created_at: Date }>(
      `select id, file_name, created_at from outputs where company_id = $1 order by created_at desc limit 50`,
      [id],
    ),
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
    keptFiles(pool, id, account.accountId),
  ]);
  const latestOutput = outputs.rows[0];

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
            <PrintButton label="Print or save as PDF" />
            {latestOutput === undefined ? null : (
              <ButtonLink
                href={`/api/outputs/${latestOutput.id}`}
                variant="secondary"
                icon="download"
                data-testid="latest-workbook"
              >
                Latest workbook
              </ButtonLink>
            )}
            {active ? (
              <ButtonLink href={`/app/companies/${id}/run`} icon="upload">
                Add a month
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
        periods={periods.rows.map((p) => p.period)}
        commentaries={commentaries.rows.map((j) => ({
          id: j.id,
          state: j.state,
          period: j.period,
          createdAt: j.created_at.toISOString(),
        }))}
      >
        <div className="grid items-start gap-5 2xl:grid-cols-2">
          <Panel title="Workbooks" icon="download" padding="none">
            {outputs.rows.length === 0 ? (
              <EmptyState icon="document" title="No workbooks yet">
                A workbook appears here once a setup or a month completes.
              </EmptyState>
            ) : (
              <ul
                className="scroll-slim flex max-h-80 flex-col divide-y divide-neutral-100 overflow-y-auto px-2 pb-2"
                data-testid="company-outputs"
              >
                {outputs.rows.map((o) => (
                  <li key={o.id}>
                    <a
                      href={`/api/outputs/${o.id}`}
                      className="group flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-neutral-25"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-positive-subtle text-positive">
                        <Icon name="file" size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.8125rem] font-medium text-neutral-900">
                          {o.file_name ?? "Workbook"}
                        </span>
                        <span className="block text-[0.75rem] text-neutral-500">
                          {ist(o.created_at)} IST
                        </span>
                      </span>
                      <Icon
                        name="download"
                        size={15}
                        className="text-neutral-300 group-hover:text-accent-600"
                      />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Files kept"
            icon="lock"
            padding="none"
            description={`Encrypted, and deleted automatically ${kept.retentionDays.toString()} days after upload.`}
          >
            <CompanyFiles files={kept.files} />
          </Panel>
        </div>

        <details className="group rounded-xl border border-neutral-200/80 bg-surface shadow-sm">
          <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-4 text-[0.9375rem] font-semibold text-neutral-900 select-none">
            <span className="flex items-center gap-2">
              <Icon name="clock" size={16} className="text-neutral-400" />
              Activity and charges
            </span>
            <Icon
              name="chevron-down"
              size={16}
              className="text-neutral-400 group-open:rotate-180"
            />
          </summary>
          {jobs.rows.length === 0 ? (
            <EmptyState icon="clock" title="Nothing has run yet">
              Everything run for this company appears here with what it charged.
            </EmptyState>
          ) : (
            <DataTable
              className="px-2 pb-2"
              maxHeight="28rem"
              head={
                <>
                  <Th>Started (IST)</Th>
                  <Th>Action</Th>
                  <Th>Status</Th>
                  <Th numeric>Credits charged</Th>
                </>
              }
            >
              {jobs.rows.map((j) => {
                const js = JOB_STATE[j.state] ?? {
                  label: j.state.replace(/_/gu, " "),
                  tone: "neutral" as BadgeTone,
                };
                return (
                  <Tr key={j.id}>
                    <Td className="whitespace-nowrap">{ist(j.created_at)}</Td>
                    <Td className="font-medium text-neutral-900">
                      {ACTION_LABELS[j.type as keyof typeof ACTION_LABELS]}
                    </Td>
                    <Td>
                      <Badge tone={js.tone} dot>
                        {js.label}
                      </Badge>
                    </Td>
                    <Td numeric>
                      {j.captured_credits === null
                        ? "—"
                        : formatCredits(j.captured_credits)}
                    </Td>
                  </Tr>
                );
              })}
            </DataTable>
          )}
        </details>

        <details className="group rounded-xl border border-neutral-200/80 bg-surface shadow-sm">
          <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-4 text-[0.9375rem] font-semibold text-neutral-900 select-none">
            <span className="flex items-center gap-2">
              <Icon name="settings" size={16} className="text-neutral-400" />
              Reporting conventions
            </span>
            <Icon
              name="chevron-down"
              size={16}
              className="text-neutral-400 group-open:rotate-180"
            />
          </summary>
          <div className="px-5 pb-5">
            <p className="mb-3 text-[0.8125rem] text-neutral-500">
              How this company&rsquo;s own books are kept. The financial year has to match
              the exports: a January year reading April&ndash;March files turns each
              year&rsquo;s first month into a whole year.
            </p>
            <ReportingConventions companyId={id} current={conventions} />
          </div>
        </details>

        <details className="group rounded-xl border border-neutral-200/80 bg-surface shadow-sm">
          <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-4 text-[0.9375rem] font-semibold text-neutral-900 select-none">
            <span className="flex items-center gap-2">
              <Icon name="trash" size={16} className="text-neutral-400" />
              Delete company
            </span>
            <Icon
              name="chevron-down"
              size={16}
              className="text-neutral-400 group-open:rotate-180"
            />
          </summary>
          <div className="px-5 pb-5">
            <p className="mb-3 text-[0.8125rem] text-neutral-500">
              Stops the monthly memory fee now; stored data is destroyed after the purge
              period.
            </p>
            <DeleteCompany companyId={id} name={company.name} />
          </div>
        </details>
      </Workspace>
    </AppFrame>
  );
}
