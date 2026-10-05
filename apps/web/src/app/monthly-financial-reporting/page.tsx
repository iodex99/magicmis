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

const PATH = "/monthly-financial-reporting";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "Monthly financial reporting software", "month-end financial reporting for small
 * business", "automated financial reports" — the US wording, so A/R aging, fiscal year and
 * financial package rather than debtors, financial year and pack.
 */

const STEPS = [
  {
    icon: "upload",
    title: "Pull the raw trial balance",
    body: "From your accounting system, as Excel, CSV or PDF. Add the open invoices and open bills reports if you want A/R and A/P aging.",
  },
  {
    icon: "sliders",
    title: "Accounts are mapped for you",
    body: "Each account is matched to a line in the report automatically, and anything that cannot be placed is shown as Unmapped. Next month the mapping carries forward.",
  },
  {
    icon: "wallet",
    title: "Run it",
    body: "One button, paid from prepaid credits at the action's standard price.",
  },
  {
    icon: "document",
    title: "Send the package",
    body: "An Excel workbook with live formulas, a dashboard and written commentary on the month.",
  },
] as const;

const FAQS: readonly Faq[] = [
  {
    question: "What should a monthly financial report include?",
    answer:
      "At minimum an income statement with the month, year to date and a comparison with the same month last year; a balance sheet; the key ratios for margin, liquidity and working capital; A/R and A/P aging; and a short commentary on what changed and why.",
  },
  {
    question: "Is this a replacement for my accounting software?",
    answer:
      "No. Your accounting system stays the book of record. This takes the trial balance it produces at month end and turns it into the reporting package, so the work between closing the books and sending the report is not done by hand.",
  },
  {
    question: "Can I use a fiscal year that does not start in January?",
    answer:
      "Yes. Each company records the month its fiscal year starts, its reporting currency and how dates are written in its raw data, and every report follows those settings.",
  },
  {
    question: "Is there a subscription?",
    answer:
      "No. You buy prepaid credits in US dollars and each action has a standard price; a job that needs more shows a quote before it runs. There are no seats and no monthly minimum.",
  },
];

export default function MonthlyFinancialReportingPage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Monthly financial reporting"
        heading="Monthly financial reporting, without the spreadsheet rebuild"
        intro="Closing the books is only half of month end. The other half — turning a trial balance into a reporting package someone will read — is usually a spreadsheet rebuilt by hand. That half can be automated without giving up control of a single number."
      />
      <AlsoCalled path={PATH} />

      <Section title="Pull the trial balance, run it, send the package">
        <Steps steps={STEPS} />
      </Section>

      <Section title="A monthly financial reporting package is the statements, the numbers behind them and the story">
        <p>
          A monthly financial reporting package is what goes to the owner, the lender or
          the client once the books are closed: the financial statements for the month,
          the ratios and aging that explain them, and a page of commentary. The word
          “package” matters — it is one document, sent on the same day every month, rather
          than a set of reports exported separately and stapled together.
        </p>
        <p>
          With {PRODUCT_NAME} the package is an Excel workbook with live formulas — income
          statement with year to date, balance sheet summary, KPIs and, where the open
          invoices and bills are loaded, A/R and A/P aging, checked to tie back to the
          trial balance — together with a dashboard and written commentary. Every figure
          on the dashboard opens onto the accounts it came from.
        </p>
      </Section>

      <Section title="A monthly financial report template, section by section">
        <ol className="flex list-decimal flex-col gap-2.5 pl-5">
          <li>
            <strong className="font-medium text-neutral-900">Summary.</strong> Five or six
            headline figures and the two or three sentences that matter most.
          </li>
          <li>
            <strong className="font-medium text-neutral-900">Income statement.</strong>{" "}
            The month, the same month last year and the year to date, from revenue down to
            net income.
          </li>
          <li>
            <strong className="font-medium text-neutral-900">Balance sheet.</strong> At
            the month end, beside the prior month end.
          </li>
          <li>
            <strong className="font-medium text-neutral-900">Cash flow.</strong> Opening
            cash, operating, investing and financing movements, closing cash.
          </li>
          <li>
            <strong className="font-medium text-neutral-900">KPIs.</strong> Gross and
            operating margin, days sales outstanding, days payable outstanding, the
            current ratio — each against the prior period.
          </li>
          <li>
            <strong className="font-medium text-neutral-900">A/R and A/P aging.</strong>{" "}
            Open balances by age, with the largest named.
          </li>
          <li>
            <strong className="font-medium text-neutral-900">Commentary.</strong> What
            moved, by how much and why — written against the figures, not restating them.
          </li>
        </ol>
      </Section>

      <Section title="A monthly financial report for a board of directors leads with what needs deciding">
        <p>
          A board reads the same package from the top down and rarely past the second
          page, so the order changes rather than the content. The summary and the
          commentary come first, the KPIs next with their trend, and the full statements
          behind them for the director who wants to check a figure. Anything that needs a
          decision — a customer drifting past ninety days, cash running below a covenant —
          belongs in the first paragraph, not in a footnote to the aging.
        </p>
        <p>
          In {PRODUCT_NAME} the board version is the dashboard, presented live from its
          own Present button, full screen. A director who asks where a number came from
          gets the answer in one click, because every figure opens the ledgers behind it.
        </p>
      </Section>

      <Section title="What you can rely on">
        <p>
          <strong className="font-medium text-neutral-900">Traceable figures.</strong>{" "}
          Every number in the package leads back to the accounts behind it.
        </p>
        <p>
          <strong className="font-medium text-neutral-900">
            Checked before delivery.
          </strong>{" "}
          The report must tie back to the trial balance you loaded.
        </p>
        <p>
          <strong className="font-medium text-neutral-900">No AI arithmetic.</strong> AI
          recognises files, proposes mappings and drafts commentary; a deterministic
          engine computes every figure.
        </p>
        <p>
          <strong className="font-medium text-neutral-900">
            Encrypted, and opened by nobody on our side.
          </strong>{" "}
          Files are encrypted under a key unique to each company, every opening is
          recorded where you can see it, and deleting the company destroys its key;
          customer and vendor names are redacted before anything is sent to the AI.
        </p>
      </Section>

      <MidCta />

      <Section title="What small businesses ask about monthly financial reporting">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext
        paths={[
          "/guides/month-end-close-checklist",
          "/guides/mis-kpis-and-ratios",
          "/guides/management-accounts-from-quickbooks",
        ]}
      />
      <ClosingCta
        heading="Send this month's package sooner"
        body={`${PRODUCT_NAME} turns your month-end trial balance into a reporting package with every figure traceable. Pay per action, from prepaid credits.`}
      />
    </PublicShell>
  );
}
