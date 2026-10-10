import { CompanyLogo } from "@/components/CompanyLogo";
import { logoUrl } from "@/lib/logo";
import type { NumberFormatOptions } from "@magicmis/core/format";
import {
  currencySymbol,
  type StatutoryFormat,
} from "@magicmis/core/reporting-conventions";
import { hiddenPeriods } from "@magicmis/jobs";
import { walletSummary } from "@magicmis/wallet";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { z } from "zod";

import { AppFrame } from "@/components/AppFrame";
import { Icon } from "@/components/Icon";
import { Badge, ButtonLink, PageHeader, type BadgeTone } from "@/components/ui";
import { accountOrRedirect } from "@/lib/account-page";
import { db } from "@/lib/db";

import { MONTHS_TO_ADD } from "@/lib/job-display";
import { CHAT_COOKIE, CHAT_THREAD_COOKIE } from "@/lib/prefs";
import { fileRows } from "@/lib/server/files";
import { boardMonths } from "@/lib/server/insights";
import { brandLogoUrl, readBrand } from "@/lib/server/brand";

import { CompanyFiles } from "./CompanyFiles";
import { ClosedCompany } from "./run/ClosedCompany";
import { closedState, pendingRun, runPrices } from "./run/run-context";
import { SetupRunner } from "./SetupRunner";
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
    commentary_language: string;
    statutory_format: StatutoryFormat;
    logo_version: string | null;
  }>(
    `select name, lifecycle_state, first_setup_at, number_format, decimals, currency,
            fy_start_month, date_order, commentary_language, statutory_format, logo_version
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
  const logo = logoUrl(id, company.logo_version);
  const headerLogo =
    logo === null ? undefined : <CompanyLogo src={logo} name={company.name} />;
  const frame = {
    accountId: account.accountId,
    businessName: account.businessName,
    company: { id, name: company.name },
  };

  if (company.first_setup_at === null) {
    // The run already there, if one is (ADR 0091): a reload mid-run follows it, and a run waiting
    // on a quote or the year question is answered here rather than paid for a second time.
    const [files, wallet, pending, prices, closed] = await Promise.all([
      fileRows(pool, { accountId: account.accountId, companyId: id }),
      walletSummary(pool, account.accountId),
      pendingRun(pool, { accountId: account.accountId, companyId: id, asked: null }),
      runPrices(pool, { accountId: account.accountId, companyId: id, mode: "setup" }),
      closedState(pool, {
        accountId: account.accountId,
        companyId: id,
        lifecycleState: company.lifecycle_state,
      }),
    ]);
    return (
      <AppFrame {...frame}>
        <PageHeader
          title={company.name}
          logo={headerLogo}
          meta={
            <Badge tone={state.tone} dot>
              {state.label}
            </Badge>
          }
          description={`Set up its MIS, the monthly management report. ${MONTHS_TO_ADD} We read them, map every ledger and build the first MIS and its dashboard; from there you chat it into shape.`}
        />
        {active || pending.live !== null ? (
          <SetupRunner
            companyId={id}
            current={{
              fyStartMonth: company.fy_start_month,
              currency: company.currency,
              numberFormat: company.number_format,
              dateOrder: company.date_order,
              commentaryLanguage: company.commentary_language,
              statutoryFormat: company.statutory_format,
            }}
            runner={{
              companyId: id,
              mode: "setup",
              businessName: account.businessName,
              availableCredits: wallet.available.toString(),
              pendingQuote: pending.quote,
              pendingYear: pending.year,
              liveRun: pending.live,
              prices,
              conventions: {
                currency: company.currency,
                numberFormat: company.number_format,
                dateOrder: company.date_order,
              },
            }}
          />
        ) : closed !== null ? (
          <ClosedCompany
            companyId={id}
            closed={closed}
            businessName={account.businessName}
          />
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

  const [hidden, periods, commentaries, brand, newestThread] = await Promise.all([
    // Months off the dashboard are off the chat's month list too (ADR 0047).
    hiddenPeriods(pool, { accountId: account.accountId, companyId: id }),
    // The months the board offers, which the stored figures decide (ADR 0087).
    boardMonths(pool, account.accountId, id),
    // Both write-ups the assistant keeps in History (ADR 0062). Where to act was left out, so
    // suggestions a customer had paid for could be found again only in the presenter's notes.
    pool.query<{
      id: string;
      state: string;
      type: "commentary" | "board_actions";
      period: string | null;
      created_at: Date;
    }>(
      `select id, state, type, stage_checkpoints->>'period' as period, created_at from jobs
        where company_id = $1 and account_id = $2 and type in ('commentary', 'board_actions')
          and state not in ('draft', 'estimated', 'cancelled')
        order by created_at desc limit 50`,
      [id, account.accountId],
    ),
    readBrand(pool, account.accountId),
    pool.query<{ id: string }>(
      `select id from chat_threads where company_id = $1 and account_id = $2
        order by created_at desc limit 1`,
      [id, account.accountId],
    ),
  ]);
  const jar = await cookies();
  // Whether the chat was left open or put away, so the first paint is already that layout.
  const chatCookie = jar.get(CHAT_COOKIE)?.value;
  const chatPreference =
    chatCookie === "open" || chatCookie === "closed" ? chatCookie : null;
  // The conversation to come back to (ADR 0091): the one this browser was last in, if it was in
  // this company, else the company's newest. "new" means it was left on a fresh one.
  const [lastCompany, lastThread] = (jar.get(CHAT_THREAD_COOKIE)?.value ?? "").split(".");
  const resumeThreadId =
    lastCompany !== id
      ? (newestThread.rows[0]?.id ?? null)
      : lastThread !== undefined && z.uuid().safeParse(lastThread).success
        ? lastThread
        : null;

  return (
    <AppFrame {...frame} wide>
      <PageHeader
        title={company.name}
        logo={headerLogo}
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
        logoUrl={logo}
        preparer={
          brand?.on === true
            ? { name: brand.name, logoUrl: brandLogoUrl(brand.logoVersion) }
            : null
        }
        businessName={account.businessName}
        money={{
          style: company.number_format,
          decimals: company.decimals,
          negativesInBrackets: true,
        }}
        currencySymbol={currencySymbol(company.currency)}
        periods={periods.filter((p) => !hidden.has(p))}
        commentaries={commentaries.rows.map((j) => ({
          id: j.id,
          state: j.state,
          period: j.period,
          createdAt: j.created_at.toISOString(),
          kind: j.type,
        }))}
        chatPreference={chatPreference}
        resumeThreadId={resumeThreadId}
      />
    </AppFrame>
  );
}
