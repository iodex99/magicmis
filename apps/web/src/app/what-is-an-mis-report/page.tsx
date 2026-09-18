import Link from "next/link";
import type { Metadata } from "next";

import {
  ClosingCta,
  Faqs,
  MarketingHeader,
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
import { pageMetadata, REPORT_NAMES } from "@/lib/seo";

const PATH = "/what-is-an-mis-report";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "What is an MIS report", "MIS full form in accounting", "MIS report meaning", "MIS vs
 * financial statements", "management accounts vs MIS" — and the glossary every other page
 * points at when it says "also called". One document, every name (ADR 0038).
 */

const NAMES: readonly {
  term: string;
  where: string;
  saidAs: string;
  path: string;
}[] = [
  {
    term: "MIS report",
    where: "India, Pakistan, Bangladesh, Sri Lanka, Nepal, the Gulf",
    saidAs:
      "“Send me the MIS”, “monthly MIS”, “MIS in Excel”. MIS is short for management information system.",
    path: "/mis-report-format",
  },
  {
    term: "Management accounts",
    where: "UK, Ireland, Australia, New Zealand, South Africa, Singapore",
    saidAs:
      "“The monthly management accounts”, “the pack”, “management information (MI)”.",
    path: "/management-accounts",
  },
  {
    term: "Monthly financial reporting",
    where: "United States, Canada",
    saidAs: "“Monthly financials”, “the monthly close package”, “management reports”.",
    path: "/monthly-financial-reporting",
  },
  {
    term: "Board pack / board report",
    where: "Anywhere there is a board",
    saidAs:
      "The management accounts plus a summary, KPIs and commentary, sent before a board meeting.",
    path: "/board-pack",
  },
  {
    term: "Month-end reporting package",
    where: "US controllers and FP&A teams",
    saidAs:
      "“The reporting package”, “month-end package”, “financial reporting package”.",
    path: "/month-end-reporting-package",
  },
  {
    term: "Management reporting pack / MI pack",
    where: "UK finance teams and FP&A",
    saidAs: "“The monthly reporting pack”, “MI pack”, “the management pack”.",
    path: "/board-pack",
  },
];

const CONTENTS: readonly [string, string][] = [
  [
    "Profit and loss",
    "The month, the year to date, and the comparisons: last month, the same month last year, budget where there is one.",
  ],
  [
    "Balance sheet summary",
    "Cash, receivables, inventory, payables and working capital at the month end, against the prior month.",
  ],
  [
    "Cash flow",
    "Where cash came from and went, usually as a summary rather than a full statement.",
  ],
  [
    "KPIs and ratios",
    "Margins, debtor and creditor days, stock days, current and quick ratio, and the ones specific to the business.",
  ],
  ["Ageing", "Receivables and payables by age, so overdue money is visible."],
  ["Commentary", "A written account of what moved and why, and what needs attention."],
];

const FAQS: readonly Faq[] = [
  {
    question: "What is the full form of MIS in accounting?",
    answer:
      "MIS stands for management information system. In Indian accounting practice “the MIS” or “the MIS report” means the monthly management report itself — the pack of P&L, balance sheet, cash and ratios prepared for the owners and managers of a business — rather than any software system.",
  },
  {
    question: "What is the difference between an MIS report and financial statements?",
    answer:
      "Financial statements (or statutory accounts) are prepared once a year in a prescribed format for filing, tax and shareholders, and are usually audited. An MIS report is prepared monthly for the people running the business, in whatever format helps them decide, is not filed anywhere, and carries detail the statutory accounts never would — KPIs, ageing, budget comparisons and commentary.",
  },
  {
    question: "Are management accounts the same as an MIS report?",
    answer:
      "Yes. They are the same monthly document under a different name. The UK, Ireland, Australia, New Zealand and South Africa say management accounts; India and much of South Asia and the Gulf say MIS report; the United States says monthly financial reporting or the month-end reporting package.",
  },
  {
    question: "What is a board pack, and how is it different?",
    answer:
      "A board pack is the set of papers sent to directors before a board meeting. The management accounts are its financial core; around them sit an executive summary, KPIs, variance commentary, and non-financial reports. A management reporting pack is the same idea for the leadership team rather than the board.",
  },
  {
    question: `Which of these does ${PRODUCT_NAME} produce?`,
    answer:
      "All of them, because they are the same report. From the raw trial balance it produces the Excel workbook — P&L, balance sheet, ratios, ageing, checks and lineage — plus a dashboard and written commentary, in your own currency, number style and financial year. Which name you call it is up to you.",
  },
];

export default function WhatIsAnMisReportPage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Guide"
        heading="What is an MIS report? One monthly document, every name it goes by"
        intro="An MIS report, management accounts, the monthly financials, the board pack, the month-end reporting package: five names, one document. Here is what it is, what it contains, and what it is called where you are."
      />

      <Section title="The short answer">
        <p>
          An MIS report — <em>management information system</em> report, though nobody
          says the long form — is the monthly report a business prepares for the people
          who run it: a profit and loss, a balance sheet summary, cash, a handful of
          ratios, ageing of what is owed, and a written note on what moved and why. It is
          prepared for decisions, not for filing, so it can carry whatever helps a
          decision and skip whatever does not.
        </p>
        <p>
          The name is Indian. The document is universal. A finance manager in Leeds
          prepares the same thing and calls it the management accounts; a controller in
          Austin closes the month and sends the reporting package; a company secretary in
          Sydney binds it into the board pack. Search for any of those and you are looking
          for the same report — which is why this site has a page written in each
          vocabulary.
        </p>
      </Section>

      <WideSection
        title="The same report, by market"
        intro="Where each name is used, how people say it, and the page here written in those words."
      >
        <div className="overflow-x-auto rounded-xl border border-neutral-200/80 bg-surface">
          <table className="w-full text-[0.9375rem]">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-[0.6875rem] font-semibold tracking-[0.06em] text-neutral-500 uppercase">
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Where it is used</th>
                <th className="px-5 py-3">How people say it</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {NAMES.map((n) => (
                <tr
                  key={n.term}
                  className="border-b border-neutral-100 align-top last:border-0"
                >
                  <td className="px-5 py-3.5 font-medium whitespace-nowrap text-neutral-900">
                    {n.term}
                  </td>
                  <td className="px-5 py-3.5 text-neutral-700">{n.where}</td>
                  <td className="px-5 py-3.5 text-neutral-600">{n.saidAs}</td>
                  <td className="px-5 py-3.5 whitespace-nowrap">
                    <Link
                      href={n.path}
                      className="font-medium text-accent-700 hover:underline"
                    >
                      Read in these words →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </WideSection>

      <Section title="What a monthly MIS report contains">
        <p>
          The sections vary by business, but a complete monthly report almost always
          carries these six. A report missing the last two is a set of tables, not an MIS.
        </p>
        <dl className="grid gap-4 sm:grid-cols-2">
          {CONTENTS.map(([name, body]) => (
            <div
              key={name}
              className="rounded-xl border border-neutral-200/80 bg-surface p-4"
            >
              <dt className="font-medium text-neutral-900">{name}</dt>
              <dd className="mt-1 text-[0.9375rem] text-neutral-600">{body}</dd>
            </div>
          ))}
        </dl>
        <p>
          For the section-by-section format with a worked example, see{" "}
          <Link href="/mis-report-format" className="text-accent-700 hover:underline">
            the MIS report format
          </Link>
          ; for a workbook you can open,{" "}
          <Link href="/mis-report-template" className="text-accent-700 hover:underline">
            download the sample MIS
          </Link>
          .
        </p>
      </Section>

      <Section title="MIS report vs financial statements">
        <p>
          Financial statements are prepared once a year, in a format the law prescribes,
          for people outside the business: the tax authority, the registrar, lenders and
          shareholders. They are usually audited and they lag the year end by months. An
          MIS report is prepared every month, in the format that helps the people inside
          the business decide, and it is finished days after the month closes. Nothing in
          it is filed. That freedom is the point: an MIS can carry budget comparisons,
          customer-level ageing, unit economics and a paragraph of opinion, none of which
          belong in a statutory set.
        </p>
      </Section>

      <Section title="Why the name matters for a search, and not for the work">
        <p>
          Type “MIS report format” into a search engine from Mumbai and you get template
          downloads from Indian accounting sites. Type “management accounts template” from
          Manchester and you get the same kind of page from British ones. The searchers
          want the same thing and mostly cannot use each other&rsquo;s results, because
          the pages are written in words they do not use. {PRODUCT_NAME} produces one
          report and describes it in every market&rsquo;s own terms:{" "}
          {REPORT_NAMES.map((n, i) => (
            <span key={n.path}>
              <Link href={n.path} className="text-accent-700 hover:underline">
                {n.term.toLowerCase()}
              </Link>
              {i < REPORT_NAMES.length - 1 ? ", " : "."}
            </span>
          ))}
        </p>
      </Section>

      <Section title="Questions people ask">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext
        paths={[
          "/mis-report-format",
          "/management-accounts",
          "/monthly-financial-reporting",
        ]}
      />
      <ClosingCta
        heading="Whatever you call it, it starts with a trial balance"
        body={`Create an account, add a company, drop in last month's trial balance, and ${PRODUCT_NAME} builds the report — in your currency, your number style and your financial year.`}
      />
    </PublicShell>
  );
}
