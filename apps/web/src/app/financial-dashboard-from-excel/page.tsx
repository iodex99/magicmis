import type { Metadata } from "next";
import Link from "next/link";

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

const PATH = "/financial-dashboard-from-excel";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "Financial dashboard from Excel", "excel to dashboard AI", "AI dashboard from Excel", "KPI
 * dashboard", "CFO dashboard", "P&L dashboard" — the Western sibling of `/mis-dashboard`, in US
 * words. Generic tools chart any spreadsheet; this page owns the accounting case, with lineage as
 * the difference. The board is built by chatting and presented live, with no print or export
 * (ADR 0046). The KPI row is invented (SPEC §2.3).
 */

const CARDS: readonly { label: string; value: string; note: string }[] = [
  { label: "Revenue", value: "$842k", note: "↑ 7.2% vs last month" },
  { label: "Gross margin", value: "38.6%", note: "↓ 1.1 pts vs last month" },
  { label: "EBITDA", value: "$96k", note: "↑ 4.8% vs last month" },
  { label: "Days sales outstanding", value: "41", note: "↓ 2 days" },
];

const ASKS: readonly { ask: string; result: string }[] = [
  {
    ask: "Show revenue and gross margin by month for this fiscal year.",
    result: "A trend chart is added to the board, and Undo is offered.",
  },
  {
    ask: "Break operating expenses down by department and show the five largest.",
    result:
      "A breakdown by the department split your books carry, sorted and limited to five.",
  },
  {
    ask: "Add a card for revenue per working day, at 22 working days a month.",
    result:
      "A figure the books do not hold is added as a formula the engine computes, using the 22 you typed.",
  },
  {
    ask: "Why did gross margin fall in March?",
    result:
      "A question, not a change: answered beside the board, every figure in the answer computed.",
  },
];

const FAQS: readonly Faq[] = [
  {
    question: "Can AI turn an Excel file into a dashboard?",
    answer:
      "Any spreadsheet can be charted. A financial dashboard is harder, because a trial balance is not a table of results: revenue is a credit balance spread across many ledgers, and each ledger has to be placed under the right line before anything is charted. Here AI helps place the ledgers and understands the changes you ask for in words; every figure on the board is computed from the ledgers by a calculation engine.",
  },
  {
    question: "What goes on a KPI dashboard for a small business?",
    answer:
      "Revenue and gross margin with their trend, EBITDA, cash and bank at the month end, days sales outstanding and days payable, working capital, and the movement in each against last month or the same month last year. A CFO dashboard adds the balance sheet ratios; a P&L dashboard goes line by line from revenue to profit.",
  },
  {
    question: "Can I export the dashboard to PDF or PowerPoint?",
    answer:
      "No. The board is presented live, full screen, from its own Present button, and any figure can still be opened to its ledgers while you present. The Excel workbook built from the same figures is the file you keep and download.",
  },
  {
    question: "Does it update each month?",
    answer:
      "When you add the month. Upload the new trial balance and the board brings it in, with your layout kept. On an unchanged chart of accounts the refresh makes no AI call at all.",
  },
];

export default function FinancialDashboardFromExcelPage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Financial dashboard"
        heading="A financial dashboard from the Excel trial balance you already export, where every figure opens to its ledgers"
        intro="Upload the trial balance as Excel, CSV or PDF, and get a KPI dashboard built from the books rather than from a spreadsheet someone rebuilt by hand. Change it by asking in words, present it live, and click any number to see the ledgers it came from."
      />
      <AlsoCalled path={PATH} />

      <WideSection
        title="A KPI dashboard reads like this, for a fictional distributor’s April"
        intro="The top row of a board. Below it can sit monthly trends, a bridge from revenue to profit, costs by month and working capital."
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

      <Section title="An AI dashboard from Excel only works if it knows what a ledger is">
        <p>
          Excel-to-dashboard AI tools chart whatever columns they are given, and for sales
          data or a survey that is enough. A trial balance is different. Revenue sits as
          credit balances across dozens of ledgers, cost of sales is split between
          purchases, freight and stock movements, and a debtor that went into credit
          belongs somewhere else entirely. Chart the columns as they stand and the
          dashboard is wrong in ways that look right.
        </p>
        <p>
          So the work starts one step earlier. Every ledger is mapped to a statement line
          once — rules first, AI for the ledgers rules cannot place, and anything
          uncertain left visible as Unmapped — and the engine computes each figure from
          the ledgers under it, checked against the trial balance. The dashboard draws
          from those figures, and so does the Excel workbook built alongside it. The full
          route is in{" "}
          <Link
            href="/trial-balance-to-financial-statements"
            className="text-accent-700 hover:underline"
          >
            trial balance to financial statements
          </Link>
          .
        </p>
      </Section>

      <Section title="You build the dashboard by asking for what you want to see">
        <p>
          The first board is chosen for the company from the figures its books actually
          hold. After that, change it in words, in the chat beside it. Before you send, it
          says whether the message will update the dashboard or ask a question.
        </p>
        <ul className="flex flex-col gap-3">
          {ASKS.map((a) => (
            <li
              key={a.ask}
              className="rounded-xl border border-neutral-200/80 bg-surface p-4"
            >
              <p className="font-medium text-neutral-900">&ldquo;{a.ask}&rdquo;</p>
              <p className="mt-1 text-[0.9375rem] text-neutral-600">{a.result}</p>
            </li>
          ))}
        </ul>
        <p>
          The AI turns a request into a change to the layout; it never types a figure. A
          number it puts in a formula has to be one you typed, and the result is computed
          by the engine. The layout is kept with the company, so next month lands on the
          same board.
        </p>
      </Section>

      <MidCta />

      <Section title="A CFO dashboard is presented live, and every figure opens its lineage">
        <p>
          Press Present and the board goes full screen for the meeting. There is no PDF or
          slide to fall out of date: what the room sees is the board itself, and when
          someone asks where a number came from, one click opens the ledgers behind it.
          That is the difference from a chart pasted into a deck, which is two steps
          removed from the books and cannot answer the question.
        </p>
        <p>
          {PRODUCT_NAME} is paid for in prepaid credits, with no subscription, and credits
          never expire. The Indian version of this page, in that market&rsquo;s words, is
          the{" "}
          <Link href="/mis-dashboard" className="text-accent-700 hover:underline">
            MIS dashboard
          </Link>
          .
        </p>
      </Section>

      <Section title="What people ask about a financial dashboard from Excel">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext
        paths={[
          "/mis-dashboard",
          "/monthly-financial-reporting",
          "/guides/mis-kpis-and-ratios",
        ]}
      />
      <ClosingCta
        heading="Build a dashboard from last month’s trial balance"
        body="Create an account, add the company and upload its raw trial balance. The board, the workbook and the commentary all draw from the same checked figures."
      />
    </PublicShell>
  );
}
