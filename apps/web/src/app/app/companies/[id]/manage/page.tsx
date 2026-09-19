import { companyStorage, uploadLimits } from "@magicmis/jobs";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { AppFrame } from "@/components/AppFrame";
import { Icon, type IconName } from "@/components/Icon";
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
import { fileRows } from "@/lib/server/files";

import { CompanyFiles } from "../CompanyFiles";
import { DeleteCompany } from "../DeleteCompany";
import { ReportingConventions } from "../ReportingConventions";

export const metadata = { title: "Files and settings" };
export const dynamic = "force-dynamic";

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

/**
 * What is true of a stored file, said plainly (ADR 0047). Every line is something the code
 * enforces, not a sentiment: sealing happens before storage, no staff tool reads a file, every
 * decryption is logged where its owner can see it, and deleting the company destroys the key.
 * It does not claim the service *cannot* decrypt — a run has to — only who and what ever does.
 */
const PROMISES: readonly { icon: IconName; title: string; body: string }[] = [
  {
    icon: "lock",
    title: "Sealed as they arrive",
    body: "Each file is encrypted under a key that belongs to this company alone, before it is stored. What we hold is ciphertext.",
  },
  {
    icon: "shield",
    title: "No person here can open one",
    body: "There is no screen, tool or staff role that opens a customer's file. One is decrypted only in memory, by the automated steps of something you start (counting its sheets when it arrives, sizing and running a run, answering a question) or by your own download.",
  },
  {
    icon: "search",
    title: "You can check",
    body: "Every time a file is opened it is recorded beside it below, with the reason. The record cannot be edited or deleted.",
  },
  {
    icon: "trash",
    title: "Yours to take back or destroy",
    body: "Download any file as you added it. Delete one and it is gone. Delete the company and its key is destroyed, which leaves everything sealed under it unreadable, to us as well.",
  },
];

/**
 * Everything about a company that is not the board (ADR 0047): how its books are kept, the files
 * it is built from, the workbooks runs produced, what was charged, and deleting it. The workspace
 * keeps the dashboard and the chat; this is one press away from it, in the rail and the header.
 */
export default async function ManageCompanyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const account = await accountOrRedirect(`/app/companies/${id}/manage`);
  if (!z.uuid().safeParse(id).success) notFound();
  const pool = db();
  const c = await pool.query<{
    name: string;
    lifecycle_state: string;
    number_format: "lakhs_crores" | "absolute" | "millions";
    currency: string;
    fy_start_month: number;
    date_order: "day_first" | "month_first";
  }>(
    `select name, lifecycle_state, number_format, currency, fy_start_month, date_order
       from companies where id = $1 and account_id = $2 and deleted_at is null`,
    [id, account.accountId],
  );
  const company = c.rows[0];
  if (company === undefined) notFound();
  const active = company.lifecycle_state === "active";

  const [jobs, outputs, files, storage, limits] = await Promise.all([
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
         where company_id = $1 and account_id = $2
           and state not in ('draft', 'estimated')
           and not (state = 'cancelled' and coalesce(captured_credits, 0) = 0)
         order by created_at desc limit 50`,
      [id, account.accountId],
    ),
    pool.query<{ id: string; file_name: string | null; created_at: Date }>(
      `select id, file_name, created_at from outputs
        where company_id = $1 and account_id = $2 order by created_at desc limit 50`,
      [id, account.accountId],
    ),
    fileRows(pool, { accountId: account.accountId, companyId: id }),
    companyStorage(pool, { accountId: account.accountId, companyId: id }),
    uploadLimits(pool),
  ]);
  // Whole percent, for a bar's width only; the figures beside it are the exact ones.
  const usedPercent = Math.min(
    100,
    Math.ceil((storage.bytes * 100) / Math.max(1, limits.maxCompanyBytes)),
  );
  const size = (n: number): string =>
    n >= 1_073_741_824
      ? `${(n / 1_073_741_824).toFixed(1)} GB`
      : n >= 1_048_576
        ? `${(n / 1_048_576).toFixed(1)} MB`
        : `${Math.ceil(n / 1024).toString()} KB`;

  return (
    <AppFrame
      accountId={account.accountId}
      businessName={account.businessName}
      company={{ id, name: company.name }}
      wide
    >
      <PageHeader
        eyebrow={company.name}
        title="Files and settings"
        description="How this company's books are kept, the files its MIS is built from, the workbooks and what was charged. The dashboard and the chat are on the company's main page."
        back={{ href: `/app/companies/${id}`, label: "Back to the dashboard" }}
        actions={
          active ? (
            <ButtonLink href={`/app/companies/${id}/run`} icon="upload">
              Add a file
            </ButtonLink>
          ) : null
        }
      />

      <div className="flex flex-col gap-5">
        <Panel
          title="Reporting conventions"
          icon="settings"
          description="How this company's own books are kept. The financial year has to match the raw data: a January year reading April–March files turns each year's first month into a whole year."
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

        <Panel
          title="Your files"
          icon="lock"
          padding="none"
          description="Kept until you delete them. Untick a file and the months it fed leave the dashboard; tick it and they return. Nothing is recomputed or charged."
        >
          <ul
            className="grid gap-3 px-5 pb-4 sm:grid-cols-2 xl:grid-cols-4"
            data-testid="file-promises"
          >
            {PROMISES.map((p) => (
              <li
                key={p.title}
                className="rounded-xl border border-neutral-200/80 bg-raised p-4"
              >
                <p className="flex items-center gap-2 text-[0.8125rem] font-semibold text-neutral-900">
                  <Icon name={p.icon} size={15} className="text-accent-600" />
                  {p.title}
                </p>
                <p className="mt-1.5 text-[0.75rem] leading-relaxed text-neutral-600">
                  {p.body}
                </p>
              </li>
            ))}
          </ul>
          <div className="px-5 pb-3" data-testid="storage-used">
            <div className="flex items-baseline justify-between gap-3 text-[0.75rem] text-neutral-600">
              <span>
                <span className="num font-medium text-neutral-900">
                  {size(storage.bytes)}
                </span>{" "}
                of {size(limits.maxCompanyBytes)} used, in {storage.files.toString()}{" "}
                {storage.files === 1 ? "file" : "files"}
              </span>
              <span className="text-neutral-500">
                Keeping files is included. Delete one and its room is free again.
              </span>
            </div>
            <div
              className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-100"
              role="presentation"
            >
              <div
                className={`h-full rounded-full ${usedPercent >= 90 ? "bg-warning" : "bg-accent-600"}`}
                style={{ width: `${usedPercent.toString()}%` }}
              />
            </div>
          </div>
          <p className="px-5 pb-3 text-[0.75rem] text-neutral-500">
            More on how data is handled in{" "}
            <Link href="/security" className="text-accent-700 hover:underline">
              security and data handling
            </Link>
            .
          </p>
          <CompanyFiles files={files} />
        </Panel>

        <div className="grid items-start gap-5 2xl:grid-cols-2">
          <Panel
            title="Workbooks"
            icon="download"
            padding="none"
            description="The Excel MIS each run produced, with live formulas."
          >
            {outputs.rows.length === 0 ? (
              <EmptyState icon="document" title="No workbooks yet">
                A workbook appears here once a file has been processed.
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
            title="Activity and charges"
            icon="clock"
            padding="none"
            description="Everything run for this company, with what it charged."
          >
            {jobs.rows.length === 0 ? (
              <EmptyState icon="clock" title="Nothing has run yet">
                Everything run for this company appears here with what it charged.
              </EmptyState>
            ) : (
              <DataTable
                className="px-2 pb-2"
                maxHeight="20rem"
                testId="company-activity"
                head={
                  <>
                    <Th>When (IST)</Th>
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

        <Panel
          title="Delete company"
          icon="trash"
          description="Stops the monthly memory fee now. Stored data, files included, is destroyed after the purge period by destroying the company's key."
        >
          <DeleteCompany companyId={id} name={company.name} />
        </Panel>
      </div>
    </AppFrame>
  );
}
