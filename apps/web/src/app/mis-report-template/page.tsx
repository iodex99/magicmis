import Link from "next/link";
import type { Metadata } from "next";

import { Icon } from "@/components/Icon";
import {
  AlsoCalled,
  ClosingCta,
  Faqs,
  FictionalNote,
  MarketingHeader,
  ReadNext,
  Section,
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

const PATH = "/mis-report-template";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "MIS report template excel", "monthly MIS template", "management accounts template",
 * "monthly management report template" — the biggest query family in this market wants a
 * file. SPEC §2.3 permits a public sample on fictional data, so the sample is a real workbook
 * rendered by the product from the synthetic fixtures (`packages/render-excel/scripts/
 * sample.ts`): the same sheets, formulas and checks a customer gets, on a company that does
 * not exist.
 */

const SAMPLE = "/samples/sample-monthly-mis.xlsx";

const SHEETS: readonly { name: string; body: string }[] = [
  {
    name: "Cover",
    body: "Who the report is for, the month, the currency, and when it was produced.",
  },
  {
    name: "P&L",
    body: "Revenue to profit after tax: this month, last month, the same month last year, the movements, and the year to date. Every cell is a live formula over the Data sheet.",
  },
  {
    name: "Ratios",
    body: "Gross and EBITDA margins, debtor, creditor and inventory days, current and quick ratio.",
  },
  {
    name: "Balance sheet",
    body: "Receivables, inventory, cash, payables and working capital at the month end.",
  },
  {
    name: "Checks",
    body: "Every validation the report passed or failed — the trial balance netting to zero, subtotals tying, continuity from last month — and how to fix each.",
  },
  {
    name: "Data",
    body: "The mapped ledger balances every figure is built from, one row per ledger per month, filterable.",
  },
  {
    name: "Lineage",
    body: "For each metric, the formula and the source rows behind it.",
  },
];

const FAQS: readonly Faq[] = [
  {
    question: "Is this a blank MIS template I can fill in?",
    answer:
      "It is better than blank: it is a complete monthly MIS on a fictional company, with the formulas in place. To use its layout for your own numbers, replace the Data sheet with your mapped ledger balances and the report sheets recompute. To skip the mapping altogether, upload your trial balance and let the product build the same workbook for you.",
  },
  {
    question: "Whose figures are these?",
    answer:
      "Nobody's. Northwind Traders is a synthetic company generated for testing, and every balance in the file is invented. No public sample here is ever computed from a customer's data.",
  },
  {
    question: "Can the template use lakhs and crores, or dollars in thousands?",
    answer:
      "The sample is in rupees with Indian grouping. The product writes each company's workbook in its own currency and number style — lakhs and crores, full figures, or millions — and states the units on every sheet, so a management accounts pack in pounds or a reporting package in dollars comes out in those.",
  },
  {
    question: "Does the same template work as a management accounts template?",
    answer:
      "Yes. Management accounts, a monthly MIS and a month-end reporting package are the same document under different names, and the sheets are the same: P&L, balance sheet, ratios, ageing where the data is loaded, checks and lineage.",
  },
];

export default function MisReportTemplatePage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Template"
        heading="An MIS report template in Excel — a complete sample month to download"
        intro="Not a blank grid with headings: a finished monthly MIS on a fictional trading company, with live formulas, checks and lineage on every figure. Open it, read it, and reuse its layout — or upload your own trial balance and get the same workbook on your numbers."
      />
      <AlsoCalled path={PATH} />

      <section className="mx-auto w-full max-w-[760px] px-6 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-accent-100 bg-accent-50/60 p-6">
          <div>
            <p className="font-semibold text-neutral-900">sample-monthly-mis.xlsx</p>
            <p className="mt-1 text-[0.875rem] text-neutral-600">
              Northwind Traders Pvt Ltd · May 2026 · 7 sheets · about 55 KB
            </p>
          </div>
          <a
            href={SAMPLE}
            download
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-accent-600 px-5 text-[0.9375rem] font-medium text-white shadow-sm hover:bg-accent-700"
          >
            <Icon name="download" size={16} />
            Download the sample
          </a>
        </div>
        <FictionalNote>
          Northwind Traders is a fictional company and every figure in the file is
          invented. Nothing here is computed from anyone&rsquo;s accounts.
        </FictionalNote>
      </section>

      <Section title="What is in the workbook">
        <dl className="flex flex-col gap-3">
          {SHEETS.map((s) => (
            <div
              key={s.name}
              className="flex gap-4 rounded-xl border border-neutral-200/80 bg-surface p-4"
            >
              <dt className="w-28 shrink-0 font-medium text-neutral-900">{s.name}</dt>
              <dd className="text-[0.9375rem] text-neutral-600">{s.body}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="How to use it as a template">
        <ol className="flex list-decimal flex-col gap-3 pl-5">
          <li>
            <strong className="font-medium text-neutral-900">
              Read the P&amp;L first.
            </strong>{" "}
            Click any figure and follow its formula to the Data sheet; that is the shape
            every report sheet takes.
          </li>
          <li>
            <strong className="font-medium text-neutral-900">
              Replace the Data sheet.
            </strong>{" "}
            One row per ledger per month, with the head each ledger maps to. The{" "}
            <Link
              href="/guides/trial-balance-to-management-report"
              className="text-accent-700 hover:underline"
            >
              mapping guide
            </Link>{" "}
            explains the heads and the sign conventions.
          </li>
          <li>
            <strong className="font-medium text-neutral-900">
              Check the Checks sheet.
            </strong>{" "}
            If the trial balance does not net to zero or a subtotal does not tie, the
            sheet says so before anyone reads a wrong figure.
          </li>
          <li>
            <strong className="font-medium text-neutral-900">Or skip the mapping.</strong>{" "}
            Upload the trial balance instead and {PRODUCT_NAME} maps the ledgers, builds
            this workbook on your figures, and remembers the mapping for next month.
            Rename a table, a row or a dashboard card and that is remembered too, for that
            company alone, so every company you add can keep its own layout.
          </li>
        </ol>
      </Section>

      <Section title="Questions people ask">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext
        paths={[
          "/mis-report-format",
          "/what-is-an-mis-report",
          "/guides/mis-kpis-and-ratios",
        ]}
      />
      <ClosingCta
        heading="The same workbook, on your month"
        body="Create an account, add a company, and drop in last month's trial balance. The report you download is this one, built from your books."
      />
    </PublicShell>
  );
}
