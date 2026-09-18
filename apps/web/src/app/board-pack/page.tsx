import Link from "next/link";
import type { Metadata } from "next";

import {
  AlsoCalled,
  ClosingCta,
  Faqs,
  MarketingHeader,
  MidCta,
  ReadNext,
  Section,
  Steps,
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

const PATH = "/board-pack";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "Board pack", "monthly board report", "board pack template", "management reporting pack",
 * "MI pack" — the UK, Irish and Australian words for the report as it reaches a board or a
 * leadership team. British vocabulary throughout: directors, aged debtors, VAT, the pack.
 */

const CONTENTS: readonly { title: string; body: string }[] = [
  {
    title: "Executive summary",
    body: "One page: the headline figures, what moved, and what the board is being asked to note or decide. Written last, read first.",
  },
  {
    title: "Management accounts",
    body: "Profit and loss for the month and year to date against budget and last year; balance sheet; cash flow. The financial core of every pack.",
  },
  {
    title: "KPIs",
    body: "The handful of measures the business runs on — margins, debtor days, cash runway, and the operational ones only it would track — with trend.",
  },
  {
    title: "Variance analysis and commentary",
    body: "For each material movement: what, by how much, why, and what happens next. The part directors actually read.",
  },
  {
    title: "Cash and working capital",
    body: "Aged debtors and creditors, cash position and forecast, and any covenant or facility headroom.",
  },
  {
    title: "Non-financial papers",
    body: "Minutes, the CEO report, committee reports, risk and compliance updates. Outside the finance function, and outside this page.",
  },
];

const STEPS: readonly {
  title: string;
  body: string;
  icon: "upload" | "table" | "document";
}[] = [
  {
    title: "Take the raw trial balance",
    body: "From Xero, Sage, QuickBooks or any system, once the month is closed. Excel, CSV or PDF.",
    icon: "upload",
  },
  {
    title: "Get the management accounts",
    body: "P&L, balance sheet, ratios, aged debtors and commentary, checked against the trial balance, in a workbook with live formulas.",
    icon: "table",
  },
  {
    title: "Bind the pack",
    body: "Print the dashboard and commentary to PDF, add the executive summary and the non-financial papers, and send it.",
    icon: "document",
  },
];

const FAQS: readonly Faq[] = [
  {
    question: "How long should a board pack be?",
    answer:
      "Shorter than it is. CIMA's guidance for the monthly management pack is ten to twenty pages, opening with an executive summary of the KPIs and an action plan. Anything a director cannot read in the hour before the meeting belongs in an appendix or a separate paper.",
  },
  {
    question:
      "What is the difference between a board pack and a management reporting pack?",
    answer:
      "The audience. A board pack goes to directors before a board meeting and carries governance papers alongside the finances. A management reporting pack — an MI pack — goes to the leadership team each month and is the finances and KPIs with commentary. The management accounts inside both are the same.",
  },
  {
    question: "When should the board pack go out?",
    answer:
      "Long enough before the meeting to be read — a week is usual. That sets the deadline for the management accounts, which sets the deadline for the month-end close. A pack that arrives the night before is a pack that gets skimmed at the table.",
  },
  {
    question: `Does ${PRODUCT_NAME} produce the whole board pack?`,
    answer:
      "It produces the financial half: the management accounts workbook, a dashboard and written commentary, every figure computed from the trial balance and checked. The executive summary and the non-financial papers are yours. Both the dashboard and the commentary print to PDF for the pack.",
  },
];

export default function BoardPackPage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Board reporting"
        heading="The monthly board pack: what goes in it, and how to produce the financial half without rebuilding it"
        intro="Directors get a pack before every meeting. Its financial core — the management accounts, KPIs and commentary — is rebuilt by hand every month in most businesses. Here is what a good pack contains, and how to stop rebuilding it."
      />
      <AlsoCalled path={PATH} />

      <Section title="What a board pack contains">
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
        <p>
          The first five are finance&rsquo;s. Of those, the management accounts, KPIs,
          ageing and commentary are computed from the same source — the month&rsquo;s
          trial balance — and that is the part that can be produced rather than assembled.
        </p>
      </Section>

      <Section title="Where the month goes">
        <p>
          Ask a finance manager how long the pack takes and the answer is usually three to
          five working days after the close: a day pulling raw data and re-keying it into
          the pack&rsquo;s spreadsheet, a day fixing the formulas the new month broke, a
          day writing commentary, and a day of review because a figure did not tie. The
          board sees the pack in the second week of the month, for a month that ended a
          fortnight ago.
        </p>
        <p>
          Almost none of that is judgement. The judgement is the commentary and the
          summary; the rest is transcription and arithmetic, done by hand because the
          spreadsheet was built by hand.
        </p>
      </Section>

      <Section title="Producing the financial half">
        <Steps steps={STEPS} />
        <p>
          The mapping from ledgers to report lines is learned from the first month and
          reused, so the second month&rsquo;s accounts take minutes and make no AI calls
          when the ledger structure has not changed. Every figure carries its lineage, so
          &ldquo;where does that number come from?&rdquo; is answered before it is asked.
          See{" "}
          <Link href="/how-it-works" className="text-accent-700 hover:underline">
            how it works
          </Link>{" "}
          for each step in detail.
        </p>
      </Section>

      <MidCta />

      <Section title="Questions people ask">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext
        paths={[
          "/management-accounts",
          "/guides/mis-commentary",
          "/guides/mis-kpis-and-ratios",
        ]}
      />
      <ClosingCta
        heading="Next month's pack, from this month's trial balance"
        body="Create an account, add the company, and load its trial balance. The management accounts, dashboard and commentary follow — checked, traceable, and ready to print for the pack."
      />
    </PublicShell>
  );
}
