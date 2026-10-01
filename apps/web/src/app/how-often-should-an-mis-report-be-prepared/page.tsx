import type { Metadata } from "next";
import Link from "next/link";

import { QuestionHeader } from "@/components/Answer";
import { ClosingCta, ReadNext, Section } from "@/components/Marketing";
import { PublicShell } from "@/components/PublicShell";
import { ArticleSchema, BreadcrumbSchema } from "@/components/StructuredData";
import { PRODUCT_NAME } from "@/lib/brand";
import { pageMetadata } from "@/lib/seo";

const PATH = "/how-often-should-an-mis-report-be-prepared";
export const metadata: Metadata = pageMetadata(PATH);

/** One question, one page (ADR 0079). */
export default function HowOftenMisPage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />

      <QuestionHeader
        topic="What is an MIS report?"
        topicPath="/what-is-an-mis-report"
        question="How often should an MIS report be prepared?"
      >
        <p>
          Monthly, for almost every business, as soon as the month&rsquo;s books are
          closed. A common target is within five to ten working days of month end.
        </p>
        <p>
          A weekly flash of cash, sales and collections can sit beside it, and a board may
          see a quarterly pack, but both are built from the same monthly figures. Monthly
          is what makes the comparisons work: this month against last, and against the
          same month last year.
        </p>
      </QuestionHeader>

      <Section title="Monthly is the rhythm the comparisons need">
        <p>
          The point of an MIS is the movement, not the balance. Revenue up, margin down,
          debtors slower to pay: every one of those is a comparison, and a comparison
          needs a regular period to compare. A month is short enough to act on and long
          enough for the accounts to be complete. Quarterly hides three months of drift;
          weekly asks the books for accuracy they rarely have mid-month.
        </p>
      </Section>

      <Section title="A weekly flash is for cash, not for the full report">
        <p>
          A business short of cash, or growing fast, often wants a weekly view. Keep it to
          what is reliable weekly: bank balance, sales booked, collections and payments
          due. The full profit and loss and balance sheet stay monthly, because accruals,
          depreciation and stock are only right at month end.
        </p>
      </Section>

      <Section title="A late MIS is read as history, not as a decision">
        <p>
          An MIS that arrives three weeks into the next month describes a business that
          has already moved on. The close is what decides the date: once the bank is
          reconciled and the month&rsquo;s entries are posted, the report itself should
          take hours, not days. The{" "}
          <Link
            href="/guides/month-end-close-checklist"
            className="text-accent-700 underline"
          >
            month-end close checklist
          </Link>{" "}
          is the order that gets there.
        </p>
      </Section>

      <Section title="What makes monthly affordable is not rebuilding it">
        <p>
          The first month is the expensive one, because every ledger has to be placed
          under a report head. {PRODUCT_NAME} keeps that mapping for the company, so each
          later month is a refresh from the new trial balance: the same checks, the same
          layout, and on unchanged books no AI at all, which is why it costs a fraction of
          the first month.
        </p>
      </Section>

      <ReadNext
        paths={[
          "/what-is-an-mis-report",
          "/guides/month-end-close-checklist",
          "/how-to-make-an-mis-report-in-excel",
        ]}
      />
      <ClosingCta heading="Make this month's MIS the quick one" />
    </PublicShell>
  );
}
