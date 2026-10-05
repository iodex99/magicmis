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

const PATH = "/ai-financial-reporting";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "AI financial reporting", "automated financial reporting for small business", "financial
 * reporting automation" — the US angle (ADR 0039). American vocabulary: A/R aging, the close,
 * financial statements, controller. The enterprise tools in this market start from a
 * connector and a six-figure contract; this starts from the raw trial balance.
 */

const STEPS: readonly {
  title: string;
  body: string;
  icon: "upload" | "table" | "chat";
}[] = [
  {
    title: "Upload the raw trial balance",
    body: "From QuickBooks, NetSuite, Sage Intacct, Xero or any system, once the month is closed. Excel, CSV or PDF. No connector, no access to grant.",
    icon: "upload",
  },
  {
    title: "Get the statements",
    body: "Income statement with year to date and comparisons, balance sheet, KPIs, A/R and A/P aging, every figure checked against the trial balance and traceable to its account.",
    icon: "table",
  },
  {
    title: "Ask, and read the commentary",
    body: "Written commentary on what moved, and an assistant that answers questions about the month — every number computed, never generated.",
    icon: "chat",
  },
];

const FAQS: readonly Faq[] = [
  {
    question: "What does AI actually do in AI financial reporting?",
    answer:
      "Here, three things: it recognizes what each uploaded sheet is, it maps accounts that rules cannot place to statement lines, and it drafts commentary around figures that are already computed. It never computes a figure and never sees a whole file — only redacted structure and samples for the step it is performing.",
  },
  {
    question: "Is this for small businesses or for enterprise finance teams?",
    answer:
      "Small and mid-sized businesses, and the accounting firms that report for them. It is priced per report in prepaid credits with no subscription, works from the raw trial balance rather than an integration project, and produces an Excel workbook you own rather than a dashboard behind a login.",
  },
  {
    question: "How does it handle our fiscal year and number format?",
    answer:
      "Each company records its fiscal year start, reporting currency and number style, and every statement follows them. If the uploaded data runs on a different fiscal year from the company's setting, the run says so rather than producing a wrong first month.",
  },
  {
    question: "Can it replace our close process?",
    answer:
      "No, and it does not try to. Reconciliations, accruals and cut-off are accounting work that happens before the trial balance is final. This starts where the close ends — the trial balance — and produces the reporting package that follows it.",
  },
];

export default function AiFinancialReportingPage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Financial reporting automation"
        heading="AI financial reporting for small businesses, from the raw trial balance you already have"
        intro="Automated monthly financial reporting without an integration project: upload the trial balance after the close and get the statements, KPIs, aging and commentary — every figure computed and checked, with AI doing the mapping and the writing and nothing else."
      />
      <AlsoCalled path={PATH} />

      <Section title="Upload the trial balance you already have, and the month's report comes back">
        <Steps steps={STEPS} />
      </Section>

      <Section title="Financial reporting automation that starts from raw data, not a connector">
        <p>
          Financial reporting automation usually begins by connecting to your ledger. That
          is a standing permission, a setup project, and a dependency on one accounting
          system. The trial balance you already pull at month end carries everything the
          reporting package needs, so {PRODUCT_NAME} starts there: raw data in, checked
          statements out. Switch accounting systems and nothing changes; the file is still
          a trial balance.
        </p>
        <p>
          Mapping accounts to statement lines is learned from the first month and reused,
          so a refresh on an unchanged chart of accounts takes minutes and makes no AI
          calls at all. The full walk-through is on{" "}
          <Link href="/how-it-works" className="text-accent-700 hover:underline">
            how it works
          </Link>
          .
        </p>
      </Section>

      <Section title="The AI maps accounts and drafts the words; every number is computed">
        <p>
          AI recognizes sheets, maps the accounts rules cannot place, and drafts
          commentary. It does not compute figures: every number in the statements, the
          dashboard and the commentary is deterministic arithmetic over the trial balance,
          and a draft that contains a number of its own is rejected by a check before it
          is shown. It does not see whole files: it receives redacted structure and
          samples for the one step it is doing. And it does not run when nothing changed.
        </p>
      </Section>

      <Section title="AI P&L analysis and balance sheet analysis, for your own month">
        <p>
          A general AI tool can explain what gross margin means. What it cannot do is tell
          you why yours moved, because it does not have your month — and if you paste the
          month in, it does the arithmetic itself and gets some of it wrong. Here the
          analysis runs on your own statements, computed first.
        </p>
        <p>
          <strong className="font-medium text-neutral-900">On the P&amp;L</strong>, the
          commentary works through revenue, gross margin and the cost lines against last
          month and the same month last year, and names the accounts that drove each
          material movement.{" "}
          <strong className="font-medium text-neutral-900">On the balance sheet</strong>,
          it covers working capital — receivable days, payable days, inventory days — the
          current ratio and the cash position, with the A/R aging behind them where it was
          loaded.
        </p>
        <p>
          Anything the commentary does not cover can be asked in plain English in the{" "}
          <Link href="/chat-with-your-mis" className="text-accent-700 hover:underline">
            chat
          </Link>
          : “which customers are past 90 days?” or “why did operating expenses rise?” The
          answer is worked out by queries over your data, and every figure in it comes
          from those results.
        </p>
      </Section>

      <MidCta />

      <Section title="What small businesses ask before they try it">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext
        paths={[
          "/monthly-financial-reporting",
          "/month-end-reporting-package",
          "/security",
        ]}
      />
      <ClosingCta
        heading="Try it on a month you have already closed"
        body="Create an account, add the company, and upload its raw trial balance. The reporting package follows — checked, traceable, and paid per report."
      />
    </PublicShell>
  );
}
