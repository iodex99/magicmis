import type { Metadata } from "next";

import {
  AlsoCalled,
  ClosingCta,
  Faqs,
  FictionalNote,
  MarketingHeader,
  MidCta,
  ReadNext,
  Section,
  WideSection,
} from "@/components/Marketing";
import { PublicShell } from "@/components/PublicShell";
import {
  ArticleSchema,
  BreadcrumbSchema,
  FaqSchema,
  type Faq,
} from "@/components/StructuredData";
import { PRODUCT_NAME } from "@/lib/brand";
import { pageMetadata } from "@/lib/seo";

const PATH = "/management-accounts";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "Management accounts" — the same monthly report, under the name most of the
 * English-speaking world outside India uses (ADR 0030).
 *
 * Its own page rather than a paragraph on the MIS one. A reader searching "management
 * accounts" wants the words they typed: the terminology, the statutory contrast with
 * filed accounts, and the conventions of their own market. A single page hedging between
 * both vocabularies would read as written for neither, and rank for neither.
 *
 * Figures are invented (SPEC §2.3 permits marketing samples on fictional data only) and
 * in pounds, because that is the market this page is written for.
 */

interface Row {
  readonly label: string;
  readonly current: string;
  readonly prior: string;
  readonly emphasis?: boolean;
}

/** A fictional UK trading company's month, in £000. Invented for illustration. */
const PL: readonly Row[] = [
  { label: "Turnover", current: "412.8", prior: "381.2" },
  { label: "Cost of sales", current: "(268.3)", prior: "(251.6)" },
  { label: "Gross profit", current: "144.5", prior: "129.6", emphasis: true },
  { label: "Administrative expenses", current: "(96.1)", prior: "(92.4)" },
  { label: "EBITDA", current: "48.4", prior: "37.2", emphasis: true },
  { label: "Depreciation and amortisation", current: "(8.9)", prior: "(8.9)" },
  { label: "Finance costs", current: "(4.2)", prior: "(4.6)" },
  { label: "Profit before tax", current: "35.3", prior: "23.7", emphasis: true },
];

const CONTENTS: readonly { title: string; body: string }[] = [
  {
    title: "Profit and loss for the period",
    body: "Turnover through to profit before tax, with the comparative period beside it and the year to date. Without a comparative it is a list of numbers, not a report.",
  },
  {
    title: "Balance sheet at the period end",
    body: "Condensed to what management acts on: stock, debtors, creditors, borrowings and cash. The statutory level of detail belongs in the year-end accounts, not here.",
  },
  {
    title: "Cash flow",
    body: "Opening cash, movement from operating, investing and financing activities, closing cash. The section owner-managers read first and the one most often missing.",
  },
  {
    title: "Key ratios and KPIs",
    body: "Gross and EBITDA margin, debtor and creditor days, stock turn, current ratio — each against the prior period so a change is visible without arithmetic.",
  },
  {
    title: "Aged debtors and creditors",
    body: "Outstanding balances in buckets with the largest few named. This is the section that most often turns into a phone call the same afternoon.",
  },
  {
    title: "Commentary",
    body: "Short, plain sentences on what moved and why, tied to the figures rather than restating them. If it can be deleted without losing information, it was a caption.",
  },
];

const FAQS: readonly Faq[] = [
  {
    question: "What are management accounts?",
    answer:
      "Monthly or quarterly financial reports prepared for the people running a business, rather than for Companies House or HMRC. They typically contain a profit and loss account, a balance sheet, cash flow, ratios and commentary. They are not statutory, not filed, and not governed by a prescribed format — the content follows what management needs to decide.",
  },
  {
    question: "Are management accounts a legal requirement?",
    answer:
      "No. They are optional and internal, unlike year-end statutory accounts. In practice lenders, investors and boards ask for them, and a company without them is making decisions on figures that are months old.",
  },
  {
    question: "How are management accounts different from statutory accounts?",
    answer:
      "Statutory accounts are annual, filed, formally formatted and usually audited. Management accounts are monthly or quarterly, internal, formatted however suits the business, and can carry operational detail and forward-looking commentary that statutory accounts never would.",
  },
  {
    question: "Are management accounts audited?",
    answer:
      "No. An audit is of the year-end statutory accounts, not the monthly management set. Management accounts are reviewed by whoever relies on them — the directors, a lender, an investor — and an auditor may read them as background, but nobody gives an opinion on them. That is why every figure in them should be traceable to the ledgers it came from.",
  },
  {
    question: "Who can prepare management accounts?",
    answer:
      "Anyone who knows the books well enough to map them. Because management accounts are internal and not filed, preparing them is not reserved to a qualified accountant the way an audit is. In practice they are prepared by the bookkeeper, an in-house finance team, or the business's external accountant as a monthly service.",
  },
  {
    question: "Is an MIS report the same as management accounts?",
    answer:
      "Effectively yes. “MIS report” is the term used in India for the same monthly management report; “management accounts” is the term in the UK, Ireland, Australia, New Zealand and South Africa. The Indian version often carries a little more operational detail alongside the financials, but the core — P&L, balance sheet, cash flow, ratios, ageing, commentary — is the same document.",
  },
  {
    question: "How long do monthly management accounts take to prepare?",
    answer:
      "Prepared by hand, a first set for a new client typically takes one to two days, and each following month a few hours of re-keying and re-checking. Most of that repeat effort is mapping ledgers to report lines — work that does not change from month to month once it is right.",
  },
  {
    question: `How does ${PRODUCT_NAME} produce them?`,
    answer:
      "You upload the raw trial balance your accounting system gives you and take an Excel workbook with live formulas, a dashboard and written commentary. Every figure traces back to the ledger it came from, and later months reuse the mapping — a refresh on unchanged structure makes no AI calls at all.",
  },
];

export default function ManagementAccountsPage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Guide"
        heading="Management accounts: what they contain, and how to prepare them monthly"
        intro="Management accounts are the monthly financial picture a business actually runs on — not the statutory accounts filed once a year. There is no prescribed format, because they exist to answer management's questions rather than a regulator's. What follows is the structure almost all of them share."
      />
      <AlsoCalled path={PATH} />

      <Section title="A set of management accounts has six parts, every month">
        <ol className="flex flex-col gap-5">
          {CONTENTS.map((c) => (
            <li key={c.title}>
              <h3 className="text-[1rem] font-semibold text-neutral-900">{c.title}</h3>
              <p className="mt-1.5 leading-relaxed text-neutral-600">{c.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <WideSection
        title="A worked example"
        intro="One month of a fictional trading company, in the shape the profit and loss section usually takes. Figures in £000."
      >
        <div className="mx-auto max-w-[760px] overflow-x-auto rounded-xl border border-neutral-200/80 bg-surface">
          <table className="w-full min-w-[420px] border-collapse text-[0.9375rem]">
            <caption className="border-b border-neutral-200/80 px-5 py-3 text-left text-[0.8125rem] font-medium text-neutral-500">
              Profit and loss for the month
            </caption>
            <thead>
              <tr className="border-b border-neutral-200/80 text-[0.8125rem] text-neutral-500">
                <th scope="col" className="px-5 py-2.5 text-left font-medium">
                  &nbsp;
                </th>
                <th scope="col" className="px-5 py-2.5 text-right font-medium">
                  This month
                </th>
                <th scope="col" className="px-5 py-2.5 text-right font-medium">
                  Prior month
                </th>
              </tr>
            </thead>
            <tbody>
              {PL.map((row) => (
                <tr
                  key={row.label}
                  className={`border-b border-neutral-100 last:border-0 ${
                    row.emphasis === true ? "bg-neutral-50/70 font-medium" : ""
                  }`}
                >
                  <th
                    scope="row"
                    className="px-5 py-2.5 text-left font-normal text-neutral-800"
                  >
                    {row.label}
                  </th>
                  <td className="px-5 py-2.5 text-right tabular-nums text-neutral-900">
                    {row.current}
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-neutral-500">
                    {row.prior}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mx-auto max-w-[760px]">
          <FictionalNote>
            Every figure above is invented for illustration — a made-up company, not a
            client. Nothing on this page is computed from anyone&rsquo;s accounts.
          </FictionalNote>
        </div>
      </WideSection>

      <Section title="Management accounts vs audited accounts: one is for running the business, the other is for the record">
        <p>
          Audited accounts are the year-end statutory accounts after an independent
          auditor has examined them and given an opinion on them. They are prepared to an
          accounting framework, filed, and read by people outside the business — HMRC,
          Companies House, lenders, shareholders — months after the year has closed.
        </p>
        <p>
          Management accounts answer a different question, sooner: how did last month go,
          and what needs doing about it? They are produced within days or weeks of the
          month end, cut to whatever level of detail management acts on, and they can
          carry estimates, operational figures and commentary an auditor would never sign.
          A business needs both, and the monthly set is what makes the year-end one
          unsurprising.
        </p>
      </Section>

      <Section title="Management accounts vs a trial balance: the trial balance is the raw material">
        <p>
          A trial balance is a list of every ledger and its closing balance, debits on one
          side and credits on the other, totalling to the same figure. It proves the books
          balance. It does not group anything, compare anything or explain anything, and a
          business with a few hundred ledgers produces one nobody outside the accounts
          team can read.
        </p>
        <p>
          Management accounts are made from it. Each ledger is mapped to a report line —
          turnover, cost of sales, administrative expenses, debtors — the lines are added
          up into a profit and loss account and a balance sheet, and the result is set
          beside last month and the year to date. Mapping is the step that takes the time,
          which is why {PRODUCT_NAME} does it once and keeps it.
        </p>
      </Section>

      <Section title="A management accounts template: what each sheet holds">
        <p>
          A template that survives more than one month keeps the data apart from the
          report. The sheets that do that, in the order they usually run:
        </p>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>
            <strong className="font-medium text-neutral-900">Trial balance data</strong> —
            the month&apos;s export, pasted as it came, never edited by hand.
          </li>
          <li>
            <strong className="font-medium text-neutral-900">Mapping</strong> — every
            ledger beside the report line it belongs to. The only sheet that needs
            judgement, and the one that goes wrong when a new ledger appears.
          </li>
          <li>
            <strong className="font-medium text-neutral-900">Profit and loss</strong> and{" "}
            <strong className="font-medium text-neutral-900">balance sheet</strong> —
            formulas that add the mapped ledgers up, with comparatives and year to date.
          </li>
          <li>
            <strong className="font-medium text-neutral-900">Cash flow</strong> — derived
            from the movement between two balance sheets and the profit for the period.
          </li>
          <li>
            <strong className="font-medium text-neutral-900">KPIs and ratios</strong>,{" "}
            <strong className="font-medium text-neutral-900">ageing</strong> and{" "}
            <strong className="font-medium text-neutral-900">commentary</strong> — read
            from the sheets above, never typed in.
          </li>
        </ul>
        <p>
          There is no empty template to download here. {PRODUCT_NAME} builds its workbook
          from your own trial balance instead — profit and loss with year to date, a
          balance sheet summary, KPIs and, where the registers are loaded, aged debtors
          and creditors — with live formulas, checked to tie back to the trial balance
          before you receive it.
        </p>
      </Section>

      <Section title="Where the month actually goes">
        <p>
          <strong className="font-medium text-neutral-900">
            Re-mapping the same ledgers.
          </strong>{" "}
          The trial balance changes every month; which nominal codes feed which report
          lines almost never does. Rebuilding that mapping is the bulk of the work and
          none of the value.
        </p>
        <p>
          <strong className="font-medium text-neutral-900">
            Chasing a figure nobody can trace.
          </strong>{" "}
          Pasted values survive until the meeting where someone asks where a number came
          from, and then the answer has to be reconstructed from a raw file that may no
          longer exist.
        </p>
        <p>
          <strong className="font-medium text-neutral-900">
            The template living with one person.
          </strong>{" "}
          When the workbook that knows the client is on one laptop, the month is late
          whenever that person is on another job.
        </p>
      </Section>

      <MidCta />

      <Section title="What people ask about preparing management accounts">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext
        paths={[
          "/for-accountants",
          "/how-it-works",
          "/guides/management-accounts-from-xero",
        ]}
      />
      <ClosingCta
        heading="Or stop rebuilding them every month"
        body={`${PRODUCT_NAME} produces the P&L, balance sheet summary, ratios and ageing from the raw trial balance you already have, with live formulas and every figure traceable. The mapping is built once and reused every month.`}
      />
    </PublicShell>
  );
}
