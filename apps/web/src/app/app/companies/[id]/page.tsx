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
  StatCard,
  Td,
  Th,
  Tr,
  type BadgeTone,
} from "@/components/ui";
import { accountOrRedirect } from "@/lib/account-page";
import { ACTION_LABELS, formatCredits } from "@/lib/actions";
import { db } from "@/lib/db";

import { DeleteCompany } from "./DeleteCompany";

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
};

const ist = (d: Date, withTime = true) =>
  d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });

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
  const [jobs, outputs, latest] = await Promise.all([
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
    pool.query<{ period: string | null }>(
      `select max(period) as period from snapshots where company_id = $1`,
      [id],
    ),
  ]);

  const state = LIFECYCLE[company.lifecycle_state] ?? {
    label: company.lifecycle_state,
    tone: "neutral" as BadgeTone,
  };
  const isSetUp = company.first_setup_at !== null;
  const active = company.lifecycle_state === "active";
  const spent = jobs.rows.reduce((sum, j) => sum + BigInt(j.captured_credits ?? "0"), 0n);

  return (
    <AppFrame
      accountId={account.accountId}
      businessName={account.businessName}
      company={{ id, name: company.name }}
    >
      <PageHeader
        title={company.name}
        back={{ href: "/app", label: "All companies" }}
        description={
          isSetUp
            ? "Its workbooks, everything that has run, and what each action cost."
            : "Not set up yet. Run the first setup to build the MIS and its mappings."
        }
        meta={
          <Badge tone={state.tone} dot>
            {state.label}
          </Badge>
        }
        actions={
          active ? (
            <ButtonLink
              href={`/app/companies/${id}/run`}
              icon={isSetUp ? "refresh" : "play"}
            >
              {isSetUp ? "Run monthly refresh" : "Set up MIS"}
            </ButtonLink>
          ) : undefined
        }
      />

      {isSetUp ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Latest period"
            value={latest.rows[0]?.period ?? "—"}
            icon="calendar"
            tone="accent"
            hint="Months are added by a refresh"
          />
          <StatCard
            label="Workbooks"
            value={outputs.rows.length.toString()}
            icon="document"
            hint="Every version is kept"
          />
          <StatCard
            label="Actions run"
            value={jobs.rows.length.toString()}
            icon="clock"
            hint="Setup, refreshes, commentary and chat"
          />
          <StatCard
            label="Credits spent here"
            value={formatCredits(spent.toString())}
            icon="wallet"
            hint="Charged on completion, never before"
          />
        </div>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,23rem)_minmax(0,1fr)]">
        <Panel title="Workbooks" icon="download" padding="none">
          {outputs.rows.length === 0 ? (
            <EmptyState icon="document" title="No workbooks yet">
              A workbook appears here once a setup or refresh completes.
            </EmptyState>
          ) : (
            <ul
              className="flex flex-col divide-y divide-neutral-100 px-2 pb-2"
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
          title="Activity"
          description="Every action run for this company, newest first."
          icon="clock"
          padding="none"
        >
          {jobs.rows.length === 0 ? (
            <EmptyState
              icon="clock"
              title="Nothing has run yet"
              action={
                active ? (
                  <ButtonLink href={`/app/companies/${id}/run`} size="sm" icon="play">
                    {isSetUp ? "Run monthly refresh" : "Set up MIS"}
                  </ButtonLink>
                ) : undefined
              }
            >
              Load this month&rsquo;s files, then run a setup or a refresh. You see the
              price and confirm it before anything is charged.
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
        </Panel>
      </div>

      <div className="mt-5">
        <Panel
          title="Delete company"
          description="Stops the monthly memory fee now; stored data is destroyed after the purge period."
          icon="trash"
        >
          <DeleteCompany companyId={id} name={company.name} />
        </Panel>
      </div>
    </AppFrame>
  );
}
