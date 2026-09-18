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

const PATH = "/mis-report-format";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "MIS report format in Excel" — the highest-volume query this product can honestly answer.
 *
 * Someone searching it is doing the work by hand this month and wants a template. The page
 * answers the question properly first, because a thin page that only pitches neither ranks
 * nor deserves to. The product follows from the answer.
 *
 * Every figure below is invented (SPEC §2.3 allows marketing samples on fictional data
 * only) and is labelled where it appears, not in a footnote.
 */

interface Row {
  readonly label: string;
  readonly current: string;
  readonly prior: string;
  readonly note?: string;
  readonly emphasis?: boolean;
}

/** A fictional trading company's month. Figures in ₹ lakh, invented for illustration. */
const PL: readonly Row[] = [
  { label: "Revenue from operations", current: "142.60", prior: "128.40" },
  { label: "Other income", current: "1.80", prior: "2.10" },
  { label: "Cost of goods sold", current: "(96.30)", prior: "(88.70)" },
  { label: "Gross profit", current: "48.10", prior: "41.80", emphasis: true },
  { label: "Employee benefits", current: "(18.40)", prior: "(17.90)" },
  { label: "Other operating expenses", current: "(12.70)", prior: "(11.20)" },
  { label: "EBITDA", current: "17.00", prior: "12.70", emphasis: true },
  { label: "Depreciation", current: "(3.10)", prior: "(3.10)" },
  { label: "Finance cost", current: "(2.40)", prior: "(2.60)" },
  { label: "Profit before tax", current: "11.50", prior: "7.00", emphasis: true },
];

const RATIOS: readonly Row[] = [
  { label: "Gross margin", current: "33.7%", prior: "32.6%" },
  { label: "EBITDA margin", current: "11.9%", prior: "9.9%" },
  { label: "Debtor days (DSO)", current: "58", prior: "64" },
  { label: "Creditor days (DPO)", current: "41", prior: "38" },
  { label: "Inventory days", current: "72", prior: "79" },
  { label: "Current ratio", current: "1.64", prior: "1.51" },
];

const SECTIONS: readonly { title: string; body: string; source: string }[] = [
  {
    title: "1. Cover and basis of preparation",
    body: "Entity name, the month and financial year, the date the figures were extracted, and whether they are provisional or final. Skipping this is the most common defect in a management report: three months later nobody can tell whether a number was before or after audit adjustments.",
    source: "Company master and the export date",
  },
  {
    title: "2. Profit and loss summary",
    body: "Revenue through to profit before tax, with the same month last year and the year to date beside it. A single column of figures is data; the comparative is what makes it a report.",
    source: "Trial balance, grouped to the P&L heads",
  },
  {
    title: "3. Balance sheet summary",
    body: "Sources and applications of funds at the month end, condensed to the heads management actually acts on — inventory, receivables, payables, borrowings, cash.",
    source: "Trial balance, grouped to the balance-sheet heads",
  },
  {
    title: "4. Cash flow",
    body: "Opening cash, movement from operations, investing and financing, closing cash. For most SMEs this is the section the owner reads first and the one most often left out.",
    source: "Movement between two trial balances, plus the cash and bank ledgers",
  },
  {
    title: "5. Ratios and KPIs",
    body: "Margins, working-capital days and liquidity, each shown against the prior period so a change is visible without arithmetic. Ratios without a comparative are decoration.",
    source: "Computed from the statements above",
  },
  {
    title: "6. Debtors and creditors ageing",
    body: "Outstanding balances in buckets — current, 30, 60, 90, over 90 — with the largest few named. This is the part of an MIS that most often turns into an action the same day.",
    source: "Bills receivable and payable registers",
  },
  {
    title: "7. Commentary",
    body: "Short, plain sentences on what moved and why, tied to the figures rather than restating them. “Gross margin rose 1.1 points as the cost of the traded goods fell” is a report; “gross margin was 33.7%” is a caption.",
    source: "Written against the computed figures",
  },
];

const FAQS: readonly Faq[] = [
  {
    question: "Is there a standard MIS report format?",
    answer:
      "No. Unlike statutory financial statements, an MIS report has no prescribed format — it is an internal management document, so its contents follow what management needs to decide. What is near-universal is the structure: a P&L summary, a balance sheet summary, cash flow, ratios, ageing, and commentary, each shown against a comparative period.",
  },
  {
    question: "What is the difference between an MIS report and financial statements?",
    answer:
      "Financial statements are prepared for external users under a prescribed format and are usually annual and audited. An MIS report is internal, monthly, and built for decisions — it can include operational detail, ageing, and forward-looking commentary that statutory statements would never carry.",
  },
  {
    question: "Which Tally reports do I need to prepare a monthly MIS?",
    answer:
      "At minimum the trial balance for the month. Add the day book or ledger vouchers to explain movements, and the bills receivable and payable registers for ageing. Export each from TallyPrime as Excel rather than PDF, so the figures stay as numbers.",
  },
  {
    question: "How long should a monthly MIS report take to prepare?",
    answer:
      "Prepared by hand in Excel, a first MIS for a new client typically takes one to two days, and each following month a few hours of re-keying and re-checking. Most of that repeat effort is mapping ledgers to report heads — work that does not change between months once it is right.",
  },
  {
    question: `How does ${PRODUCT_NAME} produce the format above?`,
    answer:
      "You upload the raw data and the ledger mapping is built for you. The workbook is then generated with live Excel formulas, a dashboard and commentary, and every figure traces back to the ledger it came from. Later months reuse the same mapping, so a refresh on unchanged structure makes no AI calls at all.",
  },
];

function Table({
  caption,
  rows,
  currentLabel,
  priorLabel,
}: {
  caption: string;
  rows: readonly Row[];
  currentLabel: string;
  priorLabel: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200/80 bg-surface">
      <table className="w-full min-w-[420px] border-collapse text-[0.9375rem]">
        <caption className="border-b border-neutral-200/80 px-5 py-3 text-left text-[0.8125rem] font-medium text-neutral-500">
          {caption}
        </caption>
        <thead>
          <tr className="border-b border-neutral-200/80 text-[0.8125rem] text-neutral-500">
            <th scope="col" className="px-5 py-2.5 text-left font-medium">
              Particulars
            </th>
            <th scope="col" className="px-5 py-2.5 text-right font-medium">
              {currentLabel}
            </th>
            <th scope="col" className="px-5 py-2.5 text-right font-medium">
              {priorLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
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
  );
}

export default function MisReportFormatPage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Guide"
        heading="MIS report format in Excel: what a monthly MIS should contain"
        intro="There is no prescribed format for a management information report — it is an internal document, so its contents follow what management needs to decide. But the structure is near-universal. Here is that structure, section by section, with a worked example."
      />
      <AlsoCalled path={PATH} />

      <Section>
        <p>
          The sections below are the ones a monthly MIS is expected to carry in Indian
          practice, in the order they are usually read. Each names the source it comes out
          of, because the hard part of building an MIS is not the layout — it is getting
          every figure to trace back to a ledger without re-keying.
        </p>
      </Section>

      <Section title="The seven sections">
        <ol className="flex flex-col gap-5">
          {SECTIONS.map((section) => (
            <li key={section.title}>
              <h3 className="text-[1rem] font-semibold text-neutral-900">
                {section.title}
              </h3>
              <p className="mt-1.5 leading-relaxed text-neutral-600">{section.body}</p>
              <p className="mt-2 text-[0.8125rem] text-neutral-500">
                <span className="font-medium text-neutral-600">Source:</span>{" "}
                {section.source}
              </p>
            </li>
          ))}
        </ol>
      </Section>

      <WideSection
        title="A worked example"
        intro="One month of a fictional trading company, in the shape the P&L summary and ratio sections take. Figures in ₹ lakh."
      >
        <div className="mx-auto grid max-w-[1000px] gap-6 lg:grid-cols-2">
          <Table
            caption="Profit and loss summary"
            rows={PL}
            currentLabel="This month"
            priorLabel="Same month LY"
          />
          <Table
            caption="Ratios and working capital"
            rows={RATIOS}
            currentLabel="This month"
            priorLabel="Prior month"
          />
        </div>
        <div className="mx-auto max-w-[760px]">
          <FictionalNote>
            Every figure above is invented for illustration — a made-up company, not a
            customer. Nothing on this page is computed from anyone&rsquo;s accounts.
          </FictionalNote>
        </div>
      </WideSection>

      <Section title="What usually goes wrong">
        <p>
          <strong className="font-medium text-neutral-900">
            The mapping is redone every month.
          </strong>{" "}
          Ledger names change, new ledgers appear, and a workbook built on cell positions
          breaks quietly. The mapping from ledgers to report heads is the asset; it should
          be recorded once and reused.
        </p>
        <p>
          <strong className="font-medium text-neutral-900">
            Figures are pasted as values.
          </strong>{" "}
          A number nobody can trace is a number nobody can defend in the meeting it was
          prepared for. Every figure should lead back to the ledger and voucher behind it.
        </p>
        <p>
          <strong className="font-medium text-neutral-900">
            The commentary restates the table.
          </strong>{" "}
          Commentary earns its place by saying what moved and why. If it can be deleted
          without losing information, it was a caption.
        </p>
        <p>
          <strong className="font-medium text-neutral-900">
            Dates are parsed month-first.
          </strong>{" "}
          Indian files are day-first. A spreadsheet that reads 03/04 as 4 March silently
          moves a month of transactions into the wrong period.
        </p>
      </Section>

      <MidCta />

      <Section title="Questions">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext paths={["/tally-mis-report", "/for-accountants", "/how-it-works"]} />
      <ClosingCta
        heading="Or stop rebuilding it every month"
        body={`${PRODUCT_NAME} produces this format from your raw accounting data, with live formulas and every figure traceable. The ledger mapping is built once and reused every month.`}
      />
    </PublicShell>
  );
}
