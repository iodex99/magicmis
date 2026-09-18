import Link from "next/link";
import type { Metadata } from "next";

import {
  AlsoCalled,
  ClosingCta,
  Faqs,
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

const PATH = "/month-end-reporting-package";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "Month-end reporting package", "monthly reporting package", "financial reporting package",
 * "month-end close package" — the US controller's words. American vocabulary throughout:
 * A/R and A/P aging, financial statements, the close, FP&A.
 */

const TIMELINE: readonly { day: string; work: string }[] = [
  {
    day: "Day 1–2",
    work: "Bank reconciliations, sub-ledger close, cut-off. A/R and A/P aging run.",
  },
  {
    day: "Day 2–3",
    work: "Accruals, prepaids, depreciation, intercompany. Trial balance reviewed.",
  },
  {
    day: "Day 3–4",
    work: "Financial statements and schedules built from the trial balance. Variances identified.",
  },
  {
    day: "Day 4–5",
    work: "Commentary written, KPIs updated, package reviewed by the controller, sent to leadership.",
  },
];

const CONTENTS: readonly { title: string; body: string }[] = [
  {
    title: "Financial statements",
    body: "Income statement for the month and year to date against budget and prior year; balance sheet; cash flow summary.",
  },
  {
    title: "Variance analysis",
    body: "Actual against budget and prior period, line by line, with a threshold for what gets a sentence.",
  },
  {
    title: "KPIs and metrics",
    body: "Gross and EBITDA margin, DSO, DPO, DIO, current and quick ratio, and the operating metrics the business runs on.",
  },
  {
    title: "A/R and A/P aging",
    body: "Receivables and payables by bucket, so collections and cash are visible at a glance.",
  },
  {
    title: "Commentary",
    body: "What changed, why, and what leadership should act on. The paragraph that makes it a package rather than a set of statements.",
  },
  {
    title: "Supporting schedules",
    body: "Whatever the reader keeps asking for: headcount, revenue by segment, cash forecast.",
  },
];

const FAQS: readonly Faq[] = [
  {
    question: "What should a month-end reporting package include?",
    answer:
      "The financial statements for the month and year to date with budget and prior-year comparisons, variance analysis with commentary, the KPIs the business tracks, A/R and A/P aging, and any supporting schedules leadership relies on. It is written for people inside the company, so it can carry detail external financial statements never would.",
  },
  {
    question: "How is the reporting package different from the financial statements?",
    answer:
      "The financial statements are the core; the package is the statements plus context — variances, commentary, KPIs, aging and schedules — delivered on a schedule to people who will act on it. A set of statements says what happened. The package says why, and what to do.",
  },
  {
    question: "How fast should the close be?",
    answer:
      "Most small and mid-sized companies close in five to ten business days; the best in three to five. The reporting package usually lands a day or two after the close. The bottleneck is rarely the accounting; it is rebuilding the package spreadsheet and writing the commentary by hand every month.",
  },
  {
    question: `Does ${PRODUCT_NAME} connect to our accounting system?`,
    answer:
      "No, deliberately. It works from the trial balance you export — from QuickBooks, NetSuite, Sage Intacct, Xero or anything else — so there is nothing to install and no access to grant. Upload the export, and the statements, KPIs, aging and commentary are produced from it, every figure checked against the trial balance and traceable to its account.",
  },
];

export default function MonthEndReportingPackagePage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Month-end close"
        heading="The month-end reporting package: what it contains, when it lands, and how to stop rebuilding it"
        intro="Every controller closes the month and then builds the package: statements, variances, KPIs, aging, commentary. Here is what a good one contains, the timeline it follows, and how the package can be produced from the trial balance instead of assembled around it."
      />
      <AlsoCalled path={PATH} />

      <Section title="What the package contains">
        <dl className="grid gap-4 sm:grid-cols-2">
          {CONTENTS.map((c) => (
            <div
              key={c.title}
              className="rounded-xl border border-neutral-200/80 bg-surface p-4"
            >
              <dt className="font-medium text-neutral-900">{c.title}</dt>
              <dd className="mt-1 text-[0.9375rem] text-neutral-600">{c.body}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="The close timeline it follows">
        <ol className="flex flex-col gap-3">
          {TIMELINE.map((t) => (
            <li
              key={t.day}
              className="flex gap-4 rounded-xl border border-neutral-200/80 bg-surface p-4"
            >
              <span className="w-20 shrink-0 font-medium whitespace-nowrap text-neutral-900">
                {t.day}
              </span>
              <span className="text-[0.9375rem] text-neutral-600">{t.work}</span>
            </li>
          ))}
        </ol>
        <p>
          Days one to three are accounting and cannot be skipped. Days three to five are
          mostly the package: moving the trial balance into the package spreadsheet,
          repairing what the new month broke, writing the commentary, and reviewing
          because a figure did not tie. The{" "}
          <Link
            href="/guides/month-end-close-checklist"
            className="text-accent-700 hover:underline"
          >
            month-end close checklist
          </Link>{" "}
          covers the first half; the rest of this page covers the second.
        </p>
      </Section>

      <Section title="Producing the package from the trial balance">
        <p>
          The package is a function of the trial balance. Every statement line is a sum of
          accounts; every variance is a subtraction; every KPI is a ratio of lines; the
          aging is a sort of open items. What is done by hand each month is the mapping of
          accounts to lines, which does not change between months, and the arithmetic,
          which a spreadsheet does badly only because it was built by hand.
        </p>
        <p>
          {PRODUCT_NAME} takes the trial balance export, maps each account to a statement
          line — by rules first, with AI for the accounts rules cannot place — and
          computes the statements, KPIs and aging with every figure checked against the
          trial balance. The commentary is drafted around those figures; it never writes a
          number of its own. The mapping is remembered, so the next month is a refresh
          that takes minutes and makes no AI calls when the chart of accounts has not
          changed.
        </p>
      </Section>

      <Section title="Questions people ask">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext
        paths={[
          "/monthly-financial-reporting",
          "/guides/month-end-close-checklist",
          "/guides/mis-commentary",
        ]}
      />
      <ClosingCta
        heading="Close the month. Upload the trial balance. Send the package."
        body="Create an account, add the company, and load last month's trial balance. The statements, KPIs, aging and commentary follow, checked and traceable."
      />
    </PublicShell>
  );
}
