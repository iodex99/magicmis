import type { Metadata } from "next";

import {
  AlsoCalled,
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

const PATH = "/mis-in-minutes";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "MIS in minutes", "automate MIS report", "automated MIS reporting in Excel".
 *
 * The promise is scoped on purpose: the monthly refresh takes minutes; the first month takes
 * longer because the mapping has to be confirmed by a person. Saying otherwise would be the
 * kind of claim a reader tests on day one.
 */

const FIRST_MONTH = [
  {
    icon: "upload",
    title: "Load the raw data",
    body: "The trial balance, and if you want ageing, the bills outstanding registers, in any format.",
  },
  {
    icon: "sliders",
    title: "The mapping is built for you",
    body: "Each ledger is matched to a report head, rules first and AI for the rest. Nothing waits for a review; anything that cannot be placed is shown as Unmapped in the workbook.",
  },
  {
    icon: "document",
    title: "Take the report",
    body: "An Excel workbook with live formulas, a dashboard and commentary, checked to tie back to the trial balance.",
  },
] as const;

const EVERY_MONTH = [
  {
    icon: "upload",
    title: "Load this month's trial balance",
    body: "Exported the same way as last month.",
  },
  {
    icon: "refresh",
    title: "Refresh",
    body: "The confirmed mapping is applied. Only ledgers that are new since last month are brought to you for a decision.",
  },
  {
    icon: "download",
    title: "Download",
    body: "The same workbook, rolled forward a month, with the comparatives and year to date updated.",
  },
] as const;

const FAQS: readonly Faq[] = [
  {
    question: "How long does a monthly MIS take to prepare by hand?",
    answer:
      "A first MIS for a new company typically takes one to two days in Excel, and each following month a few hours of re-keying, re-mapping and re-checking. Most of that repeat effort goes into work that has not changed since last month.",
  },
  {
    question: "Is it really minutes?",
    answer:
      "For a monthly refresh on unchanged ledger structure, yes — the work is reading the file, applying the mapping already built, and computing. A first setup takes a little longer while every ledger is matched, but nothing waits on you.",
  },
  {
    question: "What if a new ledger appears?",
    answer:
      "It is flagged and proposed a report head for your decision. Everything already mapped carries forward, so a new ledger costs a moment rather than a rebuild.",
  },
  {
    question: "Do I need macros or a template of my own?",
    answer:
      "No. The workbook is produced for you with ordinary Excel formulas, so it can be opened, checked and extended in Excel without macros. If you already have a report layout you like, it can be recreated from a sample of it.",
  },
];

export default function MisInMinutesPage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Automated MIS"
        heading="Your monthly MIS in minutes, not days"
        intro="The slow part of a monthly MIS is not the maths — it is re-deciding, every month, where each ledger goes. Decide once, and each month after that is a refresh: an automated MIS report from the raw trial balance, in minutes."
      />
      <AlsoCalled path={PATH} />

      <Section title="The first month">
        <Steps steps={FIRST_MONTH} />
      </Section>

      <Section title="Every month after">
        <Steps steps={EVERY_MONTH} />
        <p>
          On a month where the ledger structure has not changed, the refresh makes no AI
          calls at all — it is arithmetic on a mapping you have already approved. That is
          why it is fast, and why it costs a fraction of the first month.
        </p>
      </Section>

      <Section title="What stays the same when it gets faster">
        <p>
          <strong className="font-medium text-neutral-900">
            Every figure is traceable.
          </strong>{" "}
          Open any figure and see the ledgers behind it.
        </p>
        <p>
          <strong className="font-medium text-neutral-900">The report is checked.</strong>{" "}
          It must tie back to the trial balance before you receive it.
        </p>
        <p>
          <strong className="font-medium text-neutral-900">
            A fixed price per action.
          </strong>{" "}
          Each refresh is a fixed price in prepaid credits from the published price book.
        </p>
      </Section>

      <Section title="Questions">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext
        paths={[
          "/ai-mis-report",
          "/guides/trial-balance-to-management-report",
          "/mis-report-format",
        ]}
      />
      <ClosingCta
        heading="Stop rebuilding the MIS every month"
        body={`${PRODUCT_NAME} keeps the mapping, so next month's report is a refresh. Drop in the file and run it.`}
      />
    </PublicShell>
  );
}
