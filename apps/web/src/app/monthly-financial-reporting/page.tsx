import type { Metadata } from "next";

import {
  ClosingCta,
  Faqs,
  MarketingHeader,
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
    title: "Export the trial balance",
    body: "From your accounting system, to Excel or CSV. Add the open invoices and open bills reports if you want A/R and A/P aging.",
  },
  {
    icon: "sliders",
    title: "Confirm the account mapping, once",
    body: "Each account is proposed a line in the report. You review the ones flagged and confirm; next month they carry forward.",
  },
  {
    icon: "wallet",
    title: "See the price and run it",
    body: "A fixed price in prepaid credits, shown before anything runs.",
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
      "Yes. Each company records the month its fiscal year starts, its reporting currency and how dates are written in its exports, and every report follows those settings.",
  },
  {
    question: "Is there a subscription?",
    answer:
      "No. You buy prepaid credits in US dollars and each action has a fixed price you see before it runs. There are no seats and no monthly minimum.",
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

      <Section title="How it works">
        <Steps steps={STEPS} />
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
          <strong className="font-medium text-neutral-900">Private by design.</strong>{" "}
          Your files are processed in your browser and never uploaded; customer and vendor
          names are redacted before anything is sent.
        </p>
      </Section>

      <Section title="Questions">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext
        paths={[
          "/guides/month-end-close-checklist",
          "/guides/mis-kpis-and-ratios",
          "/automated-management-accounts",
        ]}
      />
      <ClosingCta
        heading="Send this month's package sooner"
        body={`${PRODUCT_NAME} turns your month-end trial balance into a reporting package with every figure traceable. See the price before you run it.`}
      />
    </PublicShell>
  );
}
