import Link from "next/link";
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

const PATH = "/mis-dashboard";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "MIS dashboard", "MIS dashboard in Excel", "financial dashboard for MIS", "KPI dashboard from
 * Tally" — the dashboard intent (ADR 0039). The product has a real one, so the page shows its
 * shape on fictional figures (SPEC §2.3) and says what makes it different from a chart pasted
 * into a slide: every number opens its lineage.
 */

const CARDS: readonly { label: string; value: string; note: string }[] = [
  { label: "Revenue", value: "₹1.28 Cr", note: "↑ 6.4% vs last month" },
  { label: "Gross margin", value: "31.4%", note: "↓ 0.6 pts vs last month" },
  { label: "EBITDA", value: "₹21.2 L", note: "↑ 9.1% vs last month" },
  { label: "Debtor days", value: "47", note: "↓ 3 days" },
];

const WIDGETS: readonly { title: string; body: string }[] = [
  {
    title: "KPI cards",
    body: "Revenue, margins, EBITDA, cash, debtor and creditor days — each with its movement on last month and a twelve-month trend.",
  },
  {
    title: "Revenue and profit, year to date",
    body: "Revenue, gross profit and profit after tax by month across the financial year.",
  },
  {
    title: "From revenue to profit",
    body: "A bridge from revenue through each cost head to the result for the month.",
  },
  {
    title: "Costs by month",
    body: "Direct costs, employee cost and other operating expenses, stacked, month by month.",
  },
  {
    title: "Working capital",
    body: "Receivables, inventory, payables, debtor and creditor days at the month end.",
  },
  {
    title: "Ageing",
    body: "Receivables and payables by age bucket, when the bills reports are loaded alongside the trial balance.",
  },
];

const FAQS: readonly Faq[] = [
  {
    question: "Is the MIS dashboard built in Excel or on the web?",
    answer:
      "Both, from the same figures. The workbook is Excel with live formulas; the dashboard is on the web beside a chat that answers questions about it, and it prints to PDF for a board pack. Every number on the dashboard opens its lineage — the formula and the ledgers behind it — so it is the same figure as the workbook, not a chart drawn separately.",
  },
  {
    question: "Can I change the dashboard layout?",
    answer:
      "Yes. Rename, reorder and remove cards, with a preview before anything is saved and an undo afterwards — or ask in the chat, in words, for the change. The layout is kept with the company, so next month's refresh lands on the same dashboard.",
  },
  {
    question: "Does the dashboard update automatically each month?",
    answer:
      "It updates when you add the month: upload the new trial balance, and the dashboard refresh brings the new month into every card and chart. There is no live connection to your accounting system, by design — nothing has standing access to your ledger.",
  },
  {
    question: "Where do the figures come from?",
    answer:
      "From the raw trial balance you upload, mapped to MIS heads and computed by a deterministic engine. AI maps the ledgers rules cannot place; it never computes a figure. Click any number and the dashboard shows the formula and the ledgers it was built from.",
  },
];

export default function MisDashboardPage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Dashboard"
        heading="An MIS dashboard where every number opens its own lineage"
        intro="KPIs, trends and a revenue-to-profit bridge, built from the same raw trial balance as the Excel MIS — not a chart pasted into a slide. Click a figure and see the formula and the ledgers behind it. Chat with the MIS beside it and ask why it moved."
      />
      <AlsoCalled path={PATH} />

      <WideSection
        title="What it looks like"
        intro="The KPI row from a fictional trading company's April, in the shape every company's dashboard takes."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CARDS.map((c) => (
            <div
              key={c.label}
              className="rounded-xl border border-neutral-200/80 bg-surface p-4 shadow-sm"
            >
              <p className="eyebrow">{c.label}</p>
              <p className="num mt-2 text-left text-[1.75rem] leading-none font-semibold tracking-tight text-neutral-900">
                {c.value}
              </p>
              <p className="mt-2.5 inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-[0.75rem] font-medium text-neutral-700">
                {c.note}
              </p>
            </div>
          ))}
        </div>
        <FictionalNote />
      </WideSection>

      <Section title="What is on it">
        <dl className="grid gap-4 sm:grid-cols-2">
          {WIDGETS.map((w) => (
            <div
              key={w.title}
              className="rounded-xl border border-neutral-200/80 bg-surface p-4"
            >
              <dt className="font-medium text-neutral-900">{w.title}</dt>
              <dd className="mt-1 text-[0.9375rem] text-neutral-600">{w.body}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="The difference from a dashboard in a slide">
        <p>
          Most MIS dashboards are charts drawn from a spreadsheet that was itself built by
          hand, so the dashboard is two steps removed from the books and nobody can say
          where a figure came from when a director asks. Here the dashboard, the workbook
          and the commentary are three views of one computed set of figures. Every number
          carries its lineage, and the chat beside the dashboard answers &ldquo;why did
          that move?&rdquo; from the same figures — every number in its answer computed,
          never generated.
        </p>
        <p>
          The dashboard is added once to a company and refreshed each month you add; see{" "}
          <Link href="/product" className="text-accent-700 hover:underline">
            what you get each month
          </Link>{" "}
          and{" "}
          <Link href="/pricing" className="text-accent-700 hover:underline">
            the credit packs
          </Link>
          .
        </p>
      </Section>

      <MidCta />

      <Section title="Questions people ask">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext
        paths={["/mis-report-format", "/guides/mis-kpis-and-ratios", "/ai-mis-report"]}
      />
      <ClosingCta
        heading="See it on your own month"
        body={`Create an account, add a company, and drop in last month's raw trial balance. ${PRODUCT_NAME} builds the MIS, then the dashboard beside it.`}
      />
    </PublicShell>
  );
}
