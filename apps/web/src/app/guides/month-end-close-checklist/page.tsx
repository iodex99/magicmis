import type { Metadata } from "next";

import {
  ClosingCta,
  Faqs,
  MarketingHeader,
  MidCta,
  ReadNext,
  Section,
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

const PATH = "/guides/month-end-close-checklist";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "Month end close checklist", "month end closing process". General practice only — no
 * jurisdiction's filing deadlines are named, because those differ by country and change.
 *
 * The close-length benchmark is APQC's, read on 2026-10-05 as reported by CFO.com ("Metric of
 * the Month: Cycle Time for Monthly Close", Perry D. Wiggins, 5 March 2018):
 * https://www.cfo.com/news/metric-of-the-month-cycle-time-for-monthly-close/659297/
 * APQC's own page refused the request, so nothing newer is quoted.
 */

const GROUPS: readonly { title: string; items: readonly string[] }[] = [
  {
    title: "Cash and bank",
    items: [
      "Every bank account reconciled to the statement at month end, with reconciling items listed and dated.",
      "Old unpresented cheques and uncleared deposits investigated rather than carried forward.",
      "Cash in hand counted or confirmed, if the business holds any.",
    ],
  },
  {
    title: "Sales and receivables",
    items: [
      "All goods shipped or services delivered by month end are invoiced in the month — and nothing after it.",
      "Receipts allocated to invoices, with unallocated amounts listed.",
      "Customer balances in credit reviewed: advances, duplicates or misposted receipts.",
      "Doubtful balances reviewed for a provision.",
    ],
  },
  {
    title: "Purchases and payables",
    items: [
      "Supplier invoices for goods and services received in the month are recorded, or accrued if the invoice has not arrived.",
      "Payments allocated to supplier invoices.",
      "Major supplier balances agreed to statements.",
    ],
  },
  {
    title: "Accruals and prepayments",
    items: [
      "Recurring costs not yet billed — utilities, professional fees, interest — accrued.",
      "Annual payments such as insurance or software spread across the months they cover.",
      "Payroll for the month fully recorded, including employer taxes and contributions.",
    ],
  },
  {
    title: "Stock and fixed assets",
    items: [
      "Closing inventory recorded, whether from a count or a perpetual system that has been checked.",
      "Depreciation for the month posted.",
      "Additions and disposals recorded in the fixed asset register and the ledger alike.",
    ],
  },
  {
    title: "Control and clean-up",
    items: [
      "Sales tax — GST, VAT or equivalent — ledgers reconciled to the returns being prepared.",
      "Suspense and clearing accounts cleared, or each balance explained.",
      "Intercompany or related-party balances agreed with the other side.",
      "Trial balance balances, and the period is locked against further posting.",
    ],
  },
];

const FAQS: readonly Faq[] = [
  {
    question: "Why lock the period after closing?",
    answer:
      "Because a report is only as final as the books behind it. A posting back-dated into a reported month changes a figure someone has already acted on, and the monthly reports no longer add up to the year.",
  },
  {
    question: "Can I produce the MIS before the close is finished?",
    answer:
      "You can produce a flash report, clearly marked provisional, from the trial balance as it stands. Label it as such on the cover and replace it once the close is complete — a provisional figure that is later mistaken for a final one causes more trouble than a late report.",
  },
  {
    question: `Where does ${PRODUCT_NAME} fit in the close?`,
    answer:
      "At the end of it. Once the trial balance for the month is final, load it and the report is produced from it. It does not post entries or reconcile bank accounts — it turns closed books into the monthly report.",
  },
];

export default function MonthEndCloseChecklist() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Checklist"
        heading="Month-end close checklist before the management report"
        intro="A monthly report cannot be better than the books it is prepared from. These are the checks to finish before the month's figures go into an MIS or a set of management accounts — general practice, for any country and any accounting system."
      />

      {GROUPS.map((group) => (
        <Section key={group.title} title={group.title}>
          <ul className="flex flex-col gap-2.5">
            {group.items.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="mt-1 h-4 w-4 shrink-0 rounded border border-neutral-300 bg-surface"
                />
                <span className="leading-relaxed text-neutral-700">{item}</span>
              </li>
            ))}
          </ul>
        </Section>
      ))}

      <Section title="How long should the month-end close take?">
        <p>
          The most widely quoted benchmark is APQC&rsquo;s. Of about 2,300 organisations
          that answered its general accounting survey, reported by CFO.com in March 2018,
          the median took 6.4 calendar days to close the month; the quickest quarter took
          4.8 days or less, and the slowest quarter 10 days or more. The figures are
          several years old, so treat them as a range rather than a target.
        </p>
        <p>
          For a small business the better question is what the close is waiting on. A
          close that takes a week because supplier invoices arrive late is solved by
          accruing them; one that takes a week because the report is rebuilt afterwards is
          solved by not rebuilding it. Whatever the length, the management report follows
          the close, so every day saved there is a day earlier the report reaches the
          people who act on it.
        </p>
      </Section>

      <Section title="How to speed up the month-end close: move the work into the month">
        <p>
          Most of a slow close is work that could have been done earlier, or work done
          again that was already right last month. Five changes take the most days out:
        </p>
        <ul className="flex list-disc flex-col gap-2.5 pl-5">
          <li>
            <strong className="font-medium text-neutral-900">
              Reconcile the bank weekly.
            </strong>{" "}
            Month end then has a week of items to clear rather than a month.
          </li>
          <li>
            <strong className="font-medium text-neutral-900">
              Keep a standing list of accruals and prepayments.
            </strong>{" "}
            The same twenty entries every month should be a list to tick, not a list to
            remember.
          </li>
          <li>
            <strong className="font-medium text-neutral-900">
              Set a materiality threshold.
            </strong>{" "}
            Agree in advance which differences are chased before closing and which are
            noted and carried.
          </li>
          <li>
            <strong className="font-medium text-neutral-900">
              Close to a calendar everyone can see.
            </strong>{" "}
            Who does what on which working day, so nobody waits to be asked for an invoice
            or a stock figure.
          </li>
          <li>
            <strong className="font-medium text-neutral-900">
              Stop rebuilding the report after the close.
            </strong>{" "}
            Once the trial balance is final, the report should be a refresh. With{" "}
            {PRODUCT_NAME} the ledger mapping is kept from the month before, so the
            workbook, dashboard and commentary come from the closed trial balance in
            minutes rather than days.
          </li>
        </ul>
      </Section>

      <MidCta />

      <Section title="What people ask about the month-end close">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext
        paths={[
          "/guides/trial-balance-to-management-report",
          "/management-accounts",
          "/monthly-financial-reporting",
        ]}
      />
      <ClosingCta
        heading="Closed books in, monthly report out"
        body={`Once the month is closed, ${PRODUCT_NAME} turns the trial balance into the report — P&L, balance sheet, ratios, ageing and commentary — with every figure traceable.`}
      />
    </PublicShell>
  );
}
