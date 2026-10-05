import type { Metadata } from "next";
import Link from "next/link";

import {
  ClosingCta,
  Faqs,
  FictionalNote,
  MarketingHeader,
  MidCta,
  ReadNext,
  Section,
  Steps,
  WideSection,
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

const PATH = "/guides/trial-balance-to-management-report";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "Trial balance to P&L", "mapping trial balance to financial statements", "how to prepare
 * management accounts from a trial balance". The mapping table is invented (SPEC §2.3).
 *
 * The TallyPrime facts — 28 predefined groups, 15 primary and 13 subgroups, and a ledger's
 * group chosen in its Under field — were read on Tally Solutions' own help on 2026-10-05:
 * https://help.tallysolutions.com/ledgers-and-groups-in-tallyprime/
 * https://help.tallysolutions.com/tally-prime/vat-masters/india-vat-party-ledger-tally/
 */

const MAPPING: readonly [string, string, string, string][] = [
  ["Sales – Domestic", "Sales Accounts", "(1,240)", "Revenue from operations"],
  ["Sales – Export", "Sales Accounts", "(310)", "Revenue from operations"],
  ["Purchases – Raw Material", "Purchase Accounts", "860", "Direct costs"],
  ["Freight Inward", "Direct Expenses", "42", "Direct costs"],
  ["Salaries & Wages", "Indirect Expenses", "188", "Employee cost"],
  ["Office Rent", "Indirect Expenses", "36", "Other operating expenses"],
  ["Interest on Term Loan", "Indirect Expenses", "19", "Finance costs"],
  ["Acme Distributors", "Sundry Debtors", "402", "Trade receivables"],
];

const STEPS = [
  {
    icon: "download",
    title: "Take the trial balance as numbers, not a picture",
    body: "Export it with ledger names, their groups and closing balances — Excel or CSV where you can, because a spreadsheet keeps figures as numbers. Re-keying from a printout is where most errors in a monthly report are born.",
  },
  {
    icon: "check",
    title: "Check it balances before anything else",
    body: "Total debits must equal total credits. If they do not, the problem is in the books, and no amount of work in the report will fix it.",
  },
  {
    icon: "sliders",
    title: "Map every ledger to one report head",
    body: "Revenue, direct costs, employee cost, other operating expenses, finance costs, depreciation, and on the balance sheet side receivables, inventory, cash, payables, borrowings and equity. The ledger's group is the best first guess; the accountant's judgement is the final one.",
  },
  {
    icon: "table",
    title: "Sum the heads and fix the signs",
    body: "In a trial balance credits are usually negative. A report shows revenue as a positive number, so each head needs a presentation sign as well as a total.",
  },
  {
    icon: "shield",
    title: "Prove the report ties back",
    body: "The mapped heads must add back to the trial balance total, nothing may be left unmapped, and the balance sheet must balance with the period's profit included.",
  },
  {
    icon: "refresh",
    title: "Keep the mapping for next month",
    body: "The mapping is the expensive part and it barely changes. Record it, reuse it, and review only the ledgers that are new.",
  },
] as const;

const FAQS: readonly Faq[] = [
  {
    question: "How do I get a single month's P&L from a year-to-date trial balance?",
    answer:
      "Profit and loss ledgers in most accounting systems accumulate from the start of the financial year. Take the year-to-date trial balance at this month end and subtract the one at last month end: the difference for each income and expense ledger is the month. Balance sheet ledgers are not subtracted — they are reported as at the date.",
  },
  {
    question: "What do I do with a ledger that does not fit any head?",
    answer:
      "Put it where a reader would look for it and record why. The danger is not an imperfect head, it is a different head next month. A suspense or unclassified ledger with a material balance is worth a note in the commentary rather than a quiet home in other expenses.",
  },
  {
    question: "Should I map by ledger or by group?",
    answer:
      "Map by ledger, using the group as a default. Groups are usually right, but a single ledger created under the wrong group — a loan repayment booked under indirect expenses — would otherwise flow straight into the wrong line.",
  },
  {
    question: `How does ${PRODUCT_NAME} build the mapping?`,
    answer:
      "In order: your own confirmed mapping for the ledger, then a library of common ledger names, then the ledger's group, then a close-name match. Only ledgers still unmatched go to AI, and anything it cannot place is shown as Unmapped rather than guessed. The mapping is kept; later months reuse it and match only new ledgers.",
  },
];

export default function TrialBalanceGuide() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Guide"
        heading="From trial balance to management report"
        intro="Every monthly MIS or set of management accounts starts as a trial balance. Turning one into the other is mostly a mapping exercise — deciding which report line each ledger belongs to — and then proving that nothing was lost on the way."
      />

      <Section title="Six steps from a trial balance to a management report">
        <Steps steps={STEPS} />
      </Section>

      <WideSection
        title="What a mapping looks like"
        intro="A few rows from the mapping of a fictional manufacturer. Balances in thousands; credits shown in brackets, as a trial balance holds them."
      >
        <div className="mx-auto max-w-[900px]">
          <div className="overflow-x-auto rounded-xl border border-neutral-200/80 bg-surface">
            <table className="w-full min-w-[620px] border-collapse text-[0.9375rem]">
              <thead>
                <tr className="border-b border-neutral-200/80 text-[0.8125rem] text-neutral-500">
                  <th scope="col" className="px-5 py-2.5 text-left font-medium">
                    Ledger
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-left font-medium">
                    Group
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-right font-medium">
                    Closing balance
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-left font-medium">
                    Report head
                  </th>
                </tr>
              </thead>
              <tbody>
                {MAPPING.map(([ledger, group, balance, reportHead]) => (
                  <tr key={ledger} className="border-b border-neutral-100 last:border-0">
                    <th
                      scope="row"
                      className="px-5 py-2.5 text-left font-normal text-neutral-800"
                    >
                      {ledger}
                    </th>
                    <td className="px-5 py-2.5 text-neutral-600">{group}</td>
                    <td className="px-5 py-2.5 text-right text-neutral-900 tabular-nums">
                      {balance}
                    </td>
                    <td className="px-5 py-2.5 text-neutral-800">{reportHead}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <FictionalNote>
            Invented ledgers and balances, for illustration only. Revenue from operations
            here is 1,240 + 310 = 1,550, shown as a positive figure in the report.
          </FictionalNote>
        </div>
      </WideSection>

      <Section title="A trial balance mapping template needs four columns and nothing else">
        <p>
          The mapping above is the template. Keep it as its own sheet, one row per ledger,
          with four columns:
        </p>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>
            <strong className="font-medium text-neutral-900">Ledger</strong>, spelled
            exactly as the export spells it, because that is what every formula matches
            on.
          </li>
          <li>
            <strong className="font-medium text-neutral-900">Group</strong>, from the
            accounting system, as the default for a ledger nobody has looked at yet.
          </li>
          <li>
            <strong className="font-medium text-neutral-900">Report head</strong>, the
            line of the P&amp;L or balance sheet the ledger feeds.
          </li>
          <li>
            <strong className="font-medium text-neutral-900">Note</strong>, why an unusual
            ledger went where it did, so next month&rsquo;s preparer does not undo it.
          </li>
        </ul>
        <p>
          Balances do not belong on the mapping sheet; they change every month and the
          mapping should not. Keep the trial balance on a sheet of its own and let the
          statements read both.
        </p>
      </Section>

      <Section title="Mapping a trial balance to financial statements in Excel takes one formula per line">
        <p>
          With the trial balance on one sheet and the mapping on another, add a column to
          the trial balance that looks up each ledger&rsquo;s report head — XLOOKUP, or
          INDEX and MATCH — and every line of the statements becomes a single SUMIFS: the
          sum of the balance column where the head equals that line. Multiply credit heads
          by minus one to present them as positive.
        </p>
        <p>
          Then add the two checks that keep it honest: a count of trial balance rows whose
          lookup returned nothing, which must be zero, and the balance sheet difference,
          which must be zero too. Turning an uploaded trial balance into the statements
          without the spreadsheet is on{" "}
          <Link
            href="/trial-balance-to-financial-statements"
            className="text-accent-700 hover:underline"
          >
            trial balance to financial statements
          </Link>
          .
        </p>
      </Section>

      <Section title="Ledger mapping in TallyPrime starts from the group under each ledger">
        <p>
          Every TallyPrime ledger sits under a group, chosen in the ledger&rsquo;s{" "}
          <strong className="font-medium text-neutral-900">Under</strong> field when it is
          created from{" "}
          <strong className="font-medium text-neutral-900">
            Gateway of Tally &gt; Create &gt; Ledger
          </strong>
          . TallyPrime provides 28 predefined groups — 15 primary groups and 13 subgroups
          — such as Sales Accounts, Direct Expenses, Indirect Expenses and Sundry Debtors,
          and a company can add its own beneath them.
        </p>
        <p>
          That group is most of a mapping already, which is why the example above shows
          it: Sales Accounts becomes revenue, Sundry Debtors becomes trade receivables.
          What the group cannot do is split Indirect Expenses into employee cost, rent and
          finance costs, or catch a ledger created under the wrong group. Export the trial
          balance ledger-wise so the group and the ledger name both arrive, and map by
          ledger with the group as the default. {PRODUCT_NAME} reads Tally&rsquo;s group
          structure the same way, and keeps the mapping for the months after.
        </p>
      </Section>

      <Section title="The checks that make it trustworthy">
        <p>
          <strong className="font-medium text-neutral-900">Completeness.</strong> The sum
          of every report head equals the trial balance total, and no ledger with a
          balance is unmapped. A report can look perfect and still leave out a ledger
          someone created last week.
        </p>
        <p>
          <strong className="font-medium text-neutral-900">
            The balance sheet balances.
          </strong>{" "}
          Assets equal liabilities plus equity once the year-to-date profit is included.
          If it is off by exactly the profit, the profit was left out; if by twice a
          balance, a ledger was mapped with the wrong sign.
        </p>
        <p>
          <strong className="font-medium text-neutral-900">
            Months add up to the year.
          </strong>{" "}
          The monthly P&amp;L figures sum to the year-to-date trial balance. When they do
          not, a prior month was reopened and posted to after it was reported.
        </p>
        <p>
          <strong className="font-medium text-neutral-900">Traceability.</strong> Anyone
          should be able to pick a number in the report and see the ledgers behind it.
          That is what turns a question in a review meeting from an afternoon of searching
          into a click.
        </p>
      </Section>

      <MidCta />

      <Section title="What people ask about mapping a trial balance">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext
        paths={[
          "/guides/month-end-close-checklist",
          "/guides/mis-kpis-and-ratios",
          "/mis-in-minutes",
        ]}
      />
      <ClosingCta
        heading="Map it once, reuse it every month"
        body={`${PRODUCT_NAME} builds the mapping, checks that the report ties back to the trial balance, and keeps the mapping so next month only new ledgers are matched.`}
      />
    </PublicShell>
  );
}
