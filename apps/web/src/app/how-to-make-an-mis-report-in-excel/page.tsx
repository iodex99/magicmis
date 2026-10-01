import type { Metadata } from "next";
import Link from "next/link";

import { QuestionHeader } from "@/components/Answer";
import { ClosingCta, ReadNext, Section } from "@/components/Marketing";
import { PublicShell } from "@/components/PublicShell";
import { ArticleSchema, BreadcrumbSchema } from "@/components/StructuredData";
import { PRODUCT_NAME } from "@/lib/brand";
import { pageMetadata } from "@/lib/seo";

const PATH = "/how-to-make-an-mis-report-in-excel";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * One question, one page (ADR 0079). "How to make an MIS report in Excel" is the how-to beside
 * the format page's what-goes-in: the same search box offers both, and they are different
 * readers — one was handed the term, the other has to produce the report by Friday.
 */
const STEPS: readonly [string, string][] = [
  [
    "Close the month first.",
    "Bank reconciled, sales and purchases posted, accruals and depreciation in. An MIS built on an open month is rebuilt the week after.",
  ],
  [
    "Export the trial balance with four columns.",
    "Opening balance, debits, credits and closing balance for every ledger, not just the closing figure. The movement columns are what the month's profit and loss is made of.",
  ],
  [
    "Map every ledger to a report head, once.",
    "Revenue, direct costs, employee costs, other expenses, receivables, payables and so on. This is the slow part the first month and the reusable part every month after.",
  ],
  [
    "Build the statements from the mapping, never by typing figures.",
    "Each line of the profit and loss and the balance sheet is a formula that sums the ledgers mapped to it, such as SUMIFS over the trial balance by head. A typed number is the one that goes stale.",
  ],
  [
    "Add the comparisons.",
    "This month against last month, against the same month last year, and the year to date. A figure on its own is not management information.",
  ],
  [
    "Check it before anyone reads it.",
    "The trial balance nets to zero, the balance sheet balances, and profit in the balance sheet equals profit in the profit and loss.",
  ],
  [
    "Write one line on each movement that matters.",
    "What moved, by how much and why. The commentary is what gets read; the tables are what gets checked.",
  ],
];

export default function HowToMakeMisInExcelPage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />

      <QuestionHeader
        topic="MIS report format"
        topicPath="/mis-report-format"
        question="How do you make an MIS report in Excel?"
      >
        <p>
          Export the month&rsquo;s trial balance, map every ledger to a report head once,
          and build the profit and loss, balance sheet, cash flow and ratios from those
          heads with formulas that point back at the trial balance. Then add last month
          and the same month last year, check that it balances, and write a line on each
          movement that matters.
        </p>
        <p>
          By hand the first month takes most of a day. The mapping is the part worth
          keeping, because every later month reuses it.
        </p>
      </QuestionHeader>

      <Section title="Seven steps, in the order that keeps the figures honest">
        <ol className="flex flex-col gap-3">
          {STEPS.map(([title, body], i) => (
            <li
              key={title}
              className="rounded-xl border border-neutral-200/80 bg-surface p-4"
            >
              <p className="font-semibold text-neutral-900">
                <span className="text-neutral-400">{i + 1}. </span>
                {title}
              </p>
              <p className="mt-1 text-[0.9375rem] text-neutral-600">{body}</p>
            </li>
          ))}
        </ol>
        <p>
          What each section of the finished report should contain is on the{" "}
          <Link href="/mis-report-format" className="text-accent-700 underline">
            MIS report format
          </Link>{" "}
          page; how to map ledgers is in{" "}
          <Link
            href="/guides/trial-balance-to-management-report"
            className="text-accent-700 underline"
          >
            trial balance to management report
          </Link>
          .
        </p>
      </Section>

      <Section title="The mapping is the asset, not the spreadsheet">
        <p>
          The layout of an MIS changes when a director asks for a new view. The mapping
          does not: once &ldquo;Warehouse Rent&rdquo; is an other expense and &ldquo;Sales
          — Hardware&rdquo; is revenue, they stay that way every month. Keep the mapping
          as its own sheet of two columns, ledger and head, and let every statement read
          from it. Next month you paste in a new trial balance and only the new ledgers
          need a head.
        </p>
      </Section>

      <Section title="An income ledger's closing balance is the year to date, not the month">
        <p>
          In a trial balance exported for a month, the closing balance of every income and
          expense ledger runs from the start of the financial year. The month&rsquo;s
          sales are this month&rsquo;s closing less last month&rsquo;s. Report the closing
          balance as the month and every figure after the first month of the year is
          wrong, and it still adds up.
        </p>
        <p>
          The other common breaks are a new ledger that appears in the export and is
          mapped to nothing, and credit balances added with the wrong sign. The balance
          check in step six catches the second; only a check for unmapped ledgers catches
          the first.
        </p>
      </Section>

      <Section title="Or keep the mapping and stop rebuilding the workbook">
        <p>
          {PRODUCT_NAME} does these seven steps from the raw trial balance: it maps the
          ledgers, builds a checked Excel workbook with live formulas, and opens every
          figure to the ledgers behind it. The mapping is kept for the company, so next
          month is a refresh rather than a rebuild, and a month on unchanged books uses no
          AI at all.
        </p>
      </Section>

      <ReadNext
        paths={[
          "/mis-report-format",
          "/guides/month-end-close-checklist",
          "/tally-mis-report",
        ]}
      />
      <ClosingCta heading="Build this month's MIS from the trial balance" />
    </PublicShell>
  );
}
