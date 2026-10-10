import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { periodLabel } from "@magicmis/render-dashboard";
import { z } from "zod";

import { AppFrame } from "@/components/AppFrame";
import { Alert, Badge, ButtonLink, PageHeader, Panel } from "@/components/ui";
import { accountOrRedirect } from "@/lib/account-page";
import { ACTION_LABELS, formatCredits } from "@/lib/actions";
import { db } from "@/lib/db";
import { ist, jobState } from "@/lib/job-display";

// "Run", not "Job": the internal word stays out of what a customer reads (ADR 0091).
export const metadata = { title: "Run" };
export const dynamic = "force-dynamic";

/** Runs from uploaded files, which the run screen follows while they work (ADR 0091). */
const FROM_FILES = new Set([
  "company_setup",
  "reference_mis_recreate",
  "monthly_refresh",
  "refresh_with_restructure",
]);

/** Jobs whose result is a document or a dashboard, and so lives in the company's workspace. */
const IN_THE_WORKSPACE = new Set([
  "commentary",
  "board_actions",
  "dashboard_addon",
  "dashboard_refresh",
]);

/**
 * GET /app/jobs/:id — where every email about a job lands (ADR 0086).
 *
 * "Your MIS is ready", "A job could not be completed" and "A quote is waiting" all linked here,
 * and there was no page here: every one of them opened "not found", and they are the emails that
 * bring a customer back. Links already sitting in inboxes point here too, so the fix is a page,
 * not only a corrected template.
 *
 * It sends the reader on where there is somewhere better — a paused run to the run screen that
 * can carry it on, a document or a dashboard to the workspace that shows it — and otherwise says
 * what happened: what ran, when, what it charged, what it found, and what to do next. Another
 * account's job is not found, the same as one that does not exist.
 */
export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const account = await accountOrRedirect(`/app/jobs/${id}`);
  if (!z.uuid().safeParse(id).success) notFound();
  const r = await db().query<{
    type: string;
    state: string;
    company_id: string | null;
    company_name: string | null;
    company_gone: boolean;
    captured_credits: string | null;
    failure_class: string | null;
    failure_code: string | null;
    failure_detail: string | null;
    created_at: Date;
    completed_at: Date | null;
    period: string | null;
    notices: unknown;
    output_id: string | null;
    output_name: string | null;
    live: boolean;
  }>(
    `select j.type, j.state, j.company_id, c.name as company_name,
            (c.id is null or c.deleted_at is not null) as company_gone,
            j.captured_credits::text, j.failure_class, j.failure_code, j.failure_detail,
            j.created_at, j.completed_at,
            j.stage_checkpoints ->> 'period' as period,
            j.stage_checkpoints -> 'notices' as notices,
            o.id as output_id, o.file_name as output_name,
            coalesce((j.stage_checkpoints->>'run_lease_until')::timestamptz, '-infinity') > now() as live
       from jobs j
       left join companies c on c.id = j.company_id and c.account_id = j.account_id
       left join outputs o on o.job_id = j.id and o.account_id = j.account_id
                          and o.type = 'excel'
      where j.id = $1 and j.account_id = $2
      order by o.created_at desc nulls last
      limit 1`,
    [id, account.accountId],
  );
  const job = r.rows[0];
  if (job === undefined) notFound();

  const company =
    job.company_id !== null && !job.company_gone
      ? { id: job.company_id, name: job.company_name ?? "Company" }
      : null;
  // A run waiting on its owner — a quote, or the year question (ADR 0086) — is answered where it
  // was started. A run still working is followed there too (ADR 0091): "we lost contact" links
  // here, and the run screen shows its progress and its result rather than a status to reload.
  if (
    company !== null &&
    (job.state === "needs_quote" ||
      job.state === "awaiting_review" ||
      (FROM_FILES.has(job.type) && job.live))
  )
    redirect(`/app/companies/${company.id}/run?job=${id}`);
  if (company !== null && IN_THE_WORKSPACE.has(job.type))
    redirect(
      `/app/companies/${company.id}${job.type.startsWith("dashboard") ? "" : "?chat=open"}`,
    );

  const label = (ACTION_LABELS as Record<string, string | undefined>)[job.type] ?? "Run";
  const state = jobState(job.state);
  const failed = job.state.startsWith("failed");
  const notices = Array.isArray(job.notices)
    ? job.notices.filter((n): n is string => typeof n === "string")
    : [];
  // A run's own message is the one the customer saw on the run screen; anything else is the
  // class of failure in words, never an internal detail.
  const failure =
    job.failure_code === "server_run" && job.failure_detail !== null
      ? job.failure_detail
      : job.failure_class === "platform_fault"
        ? "It stopped because of a problem on our side. No credits were charged."
        : "It stopped because of a problem in the uploaded files. Check them and add them again.";

  return (
    <AppFrame
      accountId={account.accountId}
      businessName={account.businessName}
      {...(company === null ? {} : { company })}
    >
      <PageHeader
        title={label}
        description={company === null ? undefined : company.name}
        back={
          company === null
            ? { href: "/app", label: "Companies" }
            : { href: `/app/companies/${company.id}`, label: company.name }
        }
      />
      <div className="flex max-w-2xl flex-col gap-4" data-testid="job-page">
        <Panel>
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={state.tone} dot>
              {state.label}
            </Badge>
            <span className="text-[0.8125rem] text-neutral-500">
              Started {ist(job.created_at)} IST
              {job.completed_at === null
                ? ""
                : ` · finished ${ist(job.completed_at)} IST`}
            </span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[0.875rem]">
            {job.period === null ? null : (
              <>
                <dt className="text-neutral-500">Month</dt>
                <dd className="text-neutral-900">{periodLabel(job.period)}</dd>
              </>
            )}
            <dt className="text-neutral-500">Charged</dt>
            <dd className="num text-neutral-900" data-testid="job-charged">
              {formatCredits(job.captured_credits ?? "0")} credits
            </dd>
          </dl>
        </Panel>

        {failed ? (
          <Alert tone="error" title="What happened">
            {failure}
            {/contact support/iu.test(failure) ? (
              <>
                {" "}
                <Link href="/contact" className="font-medium underline">
                  Open the contact page
                </Link>
              </>
            ) : null}
          </Alert>
        ) : null}
        {notices.length > 0 ? (
          <Alert tone="warning" title="Worth knowing">
            <ul className="flex list-disc flex-col gap-1 pl-4">
              {notices.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {job.output_id === null ? null : (
            <a
              href={`/api/outputs/${job.output_id}`}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent-600 px-4 text-[0.875rem] font-medium text-white hover:bg-accent-700"
              data-testid="job-workbook"
            >
              Download {job.output_name ?? "the workbook"}
            </a>
          )}
          {company === null ? (
            <ButtonLink href="/app" variant="secondary">
              Back to companies
            </ButtonLink>
          ) : (
            <>
              <ButtonLink
                href={`/app/companies/${company.id}`}
                variant={job.output_id === null ? "primary" : "secondary"}
              >
                Open the dashboard
              </ButtonLink>
              {failed ? (
                <ButtonLink href={`/app/companies/${company.id}/run`} variant="secondary">
                  Add the files again
                </ButtonLink>
              ) : null}
            </>
          )}
        </div>
      </div>
    </AppFrame>
  );
}
