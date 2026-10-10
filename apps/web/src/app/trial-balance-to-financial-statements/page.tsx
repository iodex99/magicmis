import type { Metadata } from "next";
import Link from "next/link";

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

const PATH = "/trial-balance-to-financial-statements";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "Trial balance to financial statements", "trial balance to balance sheet converter",
 * "financial statements from trial balance in Excel", "AI financial statement generator". The
 * "upload it and get the statements" page; `/guides/trial-balance-to-management-report` stays
 * the "map it by hand" guide, and this page sends readers there for the method rather than
 * repeating it. What the workbook holds is read from the Monthly Financial MIS template
 * (`packages/templates/src/monthly-financial-mis.ts`), which has carried a cash flow statement
 * since ADR 0086, by the indirect method from the books' own movements. These are management statements, not statutory
 * accounts, and the page says that in its own section.
 */

const STEPS: readonly {
  title: string;
  body: string;
  icon: "upload" | "sliders" | "shield" | "table";
}[] = [
  {
    title: "Upload the trial balance as your system exports it",
    body: "From Tally, Xero, QuickBooks, Sage or anything else: Excel, CSV or a PDF with real text. Ledgers, registers and bills reports can go in beside it. No template to fill in and no columns to rearrange.",
    icon: "upload",
  },
  {
    title: "Every ledger is mapped to a statement line, once",
    body: "Rules place the ledgers they recognise, AI suggests a line for the ones they cannot, and anything still uncertain is shown as Unmapped rather than guessed. The mapping is kept for the company.",
    icon: "sliders",
  },
  {
    title: "The statements are computed and checked",
    body: "A calculation engine builds each line from the ledgers under it, then checks that the trial balance nets to zero, that every balance landed somewhere and that the balance sheet balances.",
    icon: "shield",
  },
  {
    title: "Download the workbook, and read the dashboard and commentary",
    body: "An Excel workbook with live formulas, a dashboard where every figure opens to its ledgers, and written commentary on what moved.",
    icon: "table",
  },
];

const SHEETS: readonly { title: string; body: string }[] = [
  {
    title: "Profit and loss",
    body: "Revenue through gross profit and EBITDA to profit before and after tax, with gross, EBITDA and net margin — month by month across the financial year, against last month, the same month last year and last year to date.",
  },
  {
    title: "Balance sheet summary",
    body: "Current assets — receivables, inventory, cash and bank — current liabilities and payables, and working capital at the month end, against last month and the same month last year.",
  },
  {
    title: "Cash flow",
    body: "Operating, investing and financing activities for each month of the financial year and the year to date, worked out from the movements in the books and adding up to the change in cash and bank.",
  },
  {
    title: "Key ratios and KPIs",
    body: "Current and quick ratio, debtor, creditor and inventory days, and the cash conversion cycle, against last month and the same month last year.",
  },
  {
    title: "Receivables and payables ageing",
    body: "Balances by age bucket, when the bills reports are uploaded with the trial balance.",
  },
  {
    title: "Payroll cost summary",
    body: "When a pay sheet is uploaded alongside.",
  },
  {
    title: "Checks and lineage",
    body: "Every check the run made, and the ledgers behind every figure, in the workbook itself.",
  },
];

const FAQS: readonly Faq[] = [
  {
    question:
      "Is there a trial balance to balance sheet converter that works from any system?",
    answer:
      "A converter only works if it knows which ledger belongs on which line, and that is a judgement about your chart of accounts rather than a file format. Here the trial balance can come from any system, as Excel, CSV or PDF; the ledgers are mapped once for the company, and later months reuse the mapping and match only new ledgers.",
  },
  {
    question: "Does it produce a cash flow statement?",
    answer:
      "Yes. The workbook has a cash flow sheet for every month of the year and the year to date, by the indirect method: profit, depreciation and the movements in working capital, then investing and financing. Every line is worked out from the trial balances, and the three sections add up to the change in cash and bank, shown at the foot of the sheet. It is a management cash flow from the books rather than the statutory one.",
  },
  {
    question: "Can the statements be filed as statutory accounts?",
    answer:
      "No. They are monthly management statements, laid out for the people running the business. Statutory accounts follow a prescribed format, need year-end adjustments and disclosures, and are the responsibility of the directors and their accountant.",
  },
  {
    question: "Is it an AI financial statement generator?",
    answer:
      "AI does two jobs here: it maps the ledgers rules cannot place, and it drafts the commentary. It does not generate any figure. Every number is computed from the trial balance by a calculation engine, and commentary is drafted with blanks the engine fills, so a draft containing a number of its own is rejected.",
  },
  {
    question: "Do I have to map the trial balance by hand first?",
    answer:
      "No. If you would rather do it by hand, or want to check the mapping, the guide to mapping a trial balance walks through it ledger by ledger.",
  },
];

export default function TrialBalanceToStatementsPage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Financial statements"
        heading="Upload a trial balance and get the profit and loss, a balance sheet summary and KPIs back, checked"
        intro="Financial statements from a trial balance without rebuilding them in Excel every month: upload the raw export, and every ledger is mapped to a statement line, every figure computed and checked against the trial balance, and the result delivered as a workbook, a dashboard and commentary."
      />
      <AlsoCalled path={PATH} />

      <Section title="Four steps from a raw trial balance to checked statements">
        <Steps steps={STEPS} />
      </Section>

      <Section title="These are monthly management statements, not statutory accounts">
        <p>
          What comes back is the set of statements a business runs on between year ends:
          the monthly management accounts, or MIS report, as different markets call it.
          They are not statutory or audited accounts. They do not follow a filing format,
          carry no year-end adjustments or disclosure notes, and are not signed by anyone.
          If you need accounts to file, this is the monthly view that sits beside them,
          not a replacement.
        </p>
      </Section>

      <Section title="The workbook holds the profit and loss, a balance sheet summary, ratios and ageing">
        <dl className="grid gap-4 sm:grid-cols-2">
          {SHEETS.map((s) => (
            <div
              key={s.title}
              className="rounded-xl border border-neutral-200/80 bg-surface p-4"
            >
              <dt className="font-medium text-neutral-900">{s.title}</dt>
              <dd className="mt-1 text-[0.9375rem] text-neutral-600">{s.body}</dd>
            </div>
          ))}
        </dl>
        <p>
          A cash flow statement is one of the sheets: operating, investing and financing
          activities for each month and the year to date, worked out from the movements in
          the trial balances, adding up to the change in cash and bank at the foot of the
          sheet.
        </p>
      </Section>

      <Section title="A statement is only finished when it ties back to the trial balance">
        <p>
          Before the workbook is delivered, the run checks that total debits equal total
          credits, that every ledger with a balance sits in exactly one line or in a
          visible Unmapped line, that the statements add back to the trial balance to the
          last unit, and that the balance sheet balances. It also checks that every
          formula in the workbook evaluates to the figure the engine computed. A problem
          in the data — a trial balance that does not net to zero, a month missing — is
          stated on the workbook rather than hidden behind a clean-looking result.
        </p>
      </Section>

      <MidCta />

      <Section title="The AI maps and writes; it never generates a figure">
        <p>
          Most AI statement generators ask a model to produce the statements. Here the
          model does two narrower jobs: it suggests a line for ledgers the rules cannot
          place, and it drafts commentary on the movements. Every number is arithmetic
          over the trial balance. The commentary is written with blanks that the engine
          fills from the computed figures, and a draft that contains a number of its own
          is rejected before you see it. Why that split matters is in{" "}
          <Link
            href="/can-ai-prepare-financial-statements"
            className="text-accent-700 hover:underline"
          >
            can AI prepare financial statements from a trial balance?
          </Link>
        </p>
      </Section>

      <Section title="Month two is a refresh, not a rebuild">
        <p>
          The mapping is the slow part, and it barely changes. {PRODUCT_NAME} keeps it
          with the company, so next month you upload the new trial balance and only new
          ledgers need a line. On an unchanged chart of accounts the refresh makes no AI
          call at all. It is paid for in prepaid credits, with no subscription, and
          credits never expire. Doing the mapping yourself instead? The{" "}
          <Link
            href="/guides/trial-balance-to-management-report"
            className="text-accent-700 hover:underline"
          >
            guide to mapping a trial balance by hand
          </Link>{" "}
          covers it step by step.
        </p>
      </Section>

      <Section title="What people ask about turning a trial balance into financial statements">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext
        paths={[
          "/guides/trial-balance-to-management-report",
          "/management-accounts",
          "/how-to-calculate-gross-margin-from-a-trial-balance",
        ]}
      />
      <ClosingCta
        heading="Turn last month’s trial balance into checked statements"
        body="Create an account, add the company and upload the raw trial balance. The workbook, the dashboard and the commentary follow, every figure traceable to its ledgers."
      />
    </PublicShell>
  );
}
