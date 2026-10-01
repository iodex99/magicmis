import type { Metadata } from "next";

import { QuestionHeader } from "@/components/Answer";
import { ClosingCta, FictionalNote, ReadNext, Section } from "@/components/Marketing";
import { PublicShell } from "@/components/PublicShell";
import { ArticleSchema, BreadcrumbSchema } from "@/components/StructuredData";
import { PRODUCT_NAME } from "@/lib/brand";
import { pageMetadata } from "@/lib/seo";

const PATH = "/how-to-calculate-gross-margin-from-a-trial-balance";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * One question, one page (ADR 0079), narrowed to the trial balance: "gross margin" alone is a
 * fight with every finance site there is. The example is invented (SPEC §2.3), in dollars for
 * the market this page is written for, and checked to add up.
 */
const ROWS: readonly [string, string, string][] = [
  ["Revenue", "120,000", "120,000"],
  ["Opening stock", "30,000", "—"],
  ["Purchases", "70,000", "70,000"],
  ["Direct expenses (freight in)", "8,000", "8,000"],
  ["Less closing stock", "(36,000)", "—"],
  ["Direct costs", "72,000", "78,000"],
  ["Gross profit", "48,000", "42,000"],
  ["Gross margin", "40%", "35%"],
];

export default function GrossMarginFromTbPage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />

      <QuestionHeader
        topic="KPIs and ratios"
        topicPath="/guides/mis-kpis-and-ratios"
        question="How do you calculate gross margin from a trial balance?"
      >
        <p>
          Gross margin = (revenue − direct costs) ÷ revenue × 100, where direct costs are
          opening stock plus purchases and direct expenses, less closing stock.
        </p>
        <p>
          The step people miss is the stock. A trial balance shows what you bought, not
          what you sold, so without the closing-stock adjustment the margin is wrong by
          however much stock moved in the month.
        </p>
      </QuestionHeader>

      <Section title="A trial balance shows what you bought, not what you sold">
        <p>
          In an invented month, the same ledgers give a 40% margin with the stock
          adjustment and 35% without it. The five points are $6,000 of stock that was
          bought and not sold.
        </p>
        <div className="overflow-x-auto rounded-xl border border-neutral-200/80 bg-surface">
          <table className="w-full min-w-[440px] border-collapse text-[0.9375rem] tabular-nums">
            <thead>
              <tr className="border-b border-neutral-200/80 text-left text-[0.8125rem] text-neutral-500">
                <th scope="col" className="px-4 py-2.5 font-medium">
                  US dollars
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  With stock adjusted
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Purchases as cost
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([label, a, b]) => (
                <tr key={label} className="border-b border-neutral-100 last:border-0">
                  <th
                    scope="row"
                    className="px-4 py-2 text-left font-normal text-neutral-700"
                  >
                    {label}
                  </th>
                  <td className="px-4 py-2 text-right text-neutral-900">{a}</td>
                  <td className="px-4 py-2 text-right text-neutral-900">{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <FictionalNote />
      </Section>

      <Section title="Which ledgers count as direct costs">
        <p>
          Purchases of goods for resale or raw materials, freight inward and other direct
          expenses, and the change in inventory. Direct labour is treated either way, and
          a report should say which. Rent, salaries of administrative staff, marketing and
          depreciation are operating expenses: they come after gross profit, not before
          it. Put one in the wrong place and gross margin and operating costs are both
          wrong while profit stays the same, which is why nobody notices.
        </p>
      </Section>

      <Section title="A month's margin needs a month's figures">
        <p>
          Income and expense balances in a trial balance run from the start of the
          financial year. The month&rsquo;s revenue and direct costs are this
          month&rsquo;s closing balances less last month&rsquo;s, except in the first
          month of the year. Gross margin on year-to-date balances is a year-to-date
          margin, which is a different figure.
        </p>
      </Section>

      <Section title="Mapped once, computed every month">
        <p>
          {PRODUCT_NAME} maps each ledger to a report head the first month and keeps the
          mapping, then computes gross profit as revenue less direct costs and gross
          margin as gross profit ÷ revenue × 100 for each month. Every figure opens to the
          ledgers behind it, so a misplaced ledger is visible rather than averaged in.
        </p>
      </Section>

      <ReadNext
        paths={[
          "/guides/mis-kpis-and-ratios",
          "/how-to-calculate-ebitda-in-an-mis-report",
          "/guides/trial-balance-to-management-report",
        ]}
      />
      <ClosingCta heading="Get gross margin from your own trial balance" />
    </PublicShell>
  );
}
