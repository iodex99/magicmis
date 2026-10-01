import type { Metadata } from "next";
import Link from "next/link";

import { QuestionHeader } from "@/components/Answer";
import { ClosingCta, FictionalNote, ReadNext, Section } from "@/components/Marketing";
import { PublicShell } from "@/components/PublicShell";
import { ArticleSchema, BreadcrumbSchema } from "@/components/StructuredData";
import { PRODUCT_NAME } from "@/lib/brand";
import { pageMetadata } from "@/lib/seo";

const PATH = "/how-to-calculate-debtor-days";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * One question, one page (ADR 0079). The formula is the engine's own (ADR 0020,
 * `packages/engine/src/metrics.ts`): receivables ÷ the month's revenue × the month's days.
 * The example is invented (SPEC §2.3) and says so where it appears.
 */
export default function DebtorDaysPage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />

      <QuestionHeader
        topic="KPIs and ratios"
        topicPath="/guides/mis-kpis-and-ratios"
        question="How do you calculate debtor days?"
      >
        <p>
          Debtor days = trade receivables at the month end ÷ the month&rsquo;s revenue ×
          the number of days in that month.
        </p>
        <p>
          Take an invented business owed ₹45 lakh at the end of a 30-day month in which it
          sold ₹60 lakh: 45 ÷ 60 × 30 = 22.5 debtor days, so customers take about three
          weeks to pay. Use the month&rsquo;s own revenue and its own number of days, so a
          short February does not look like a collections problem.
        </p>
      </QuestionHeader>
      <div className="mx-auto w-full max-w-[760px] px-6">
        <FictionalNote />
      </div>

      <Section title="Use the month's revenue, not the year's">
        <p>
          The other common version divides receivables by a year&rsquo;s revenue and
          multiplies by 365. It is smoother, and it is slow: a business whose sales
          doubled this quarter looks as if its customers pay twice as late. In a monthly
          MIS, use the month, read the trend across months, and say which basis the report
          uses. Debtor days is also called DSO, days sales outstanding: the DSO formula
          and the debtor days formula are the same thing.
        </p>
      </Section>

      <Section title="Receivables include GST, revenue does not">
        <p>
          A receivable is the invoice total, tax included; revenue is booked without it.
          So debtor days computed straight from the books run higher than the real
          collection period by roughly the tax rate. Either basis is defensible if it is
          stated and kept the same every month, because what a reader acts on is the
          direction.
        </p>
      </Section>

      <Section title="A rising number is cash stuck with customers">
        <p>
          Debtor days rising while sales are flat means collections are slipping, and it
          is usually the first ratio worth acting on. Rising after a month-end burst of
          sales is the calendar, not the customers. The{" "}
          <Link
            href="/guides/debtors-ageing-report"
            className="text-accent-700 underline"
          >
            debtors ageing report
          </Link>{" "}
          shows which customers are behind it.
        </p>
      </Section>

      <Section title="Computed every month, the same way">
        <p>
          {PRODUCT_NAME} computes debtor days as trade receivables ÷ the month&rsquo;s
          revenue × the days in the month, as booked, beside creditor days and inventory
          days. Each opens to the receivables and revenue ledgers it came from.
        </p>
      </Section>

      <ReadNext
        paths={[
          "/guides/mis-kpis-and-ratios",
          "/guides/debtors-ageing-report",
          "/how-to-calculate-gross-margin-from-a-trial-balance",
        ]}
      />
      <ClosingCta heading="Have debtor days computed from your trial balance" />
    </PublicShell>
  );
}
