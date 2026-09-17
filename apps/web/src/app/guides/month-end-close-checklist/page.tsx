import type { Metadata } from "next";

import {
  ClosingCta,
  Faqs,
  MarketingHeader,
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
    question: "How long should a month-end close take?",
    answer:
      "For a small or mid-sized business, a close that finishes within five to ten working days is common, and faster is possible once reconciliations are kept up during the month. The management report follows the close, so every day saved there is a day earlier the report reaches the people who act on it.",
  },
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
                  className="mt-1 h-4 w-4 shrink-0 rounded border border-neutral-300 bg-white"
                />
                <span className="leading-relaxed text-neutral-700">{item}</span>
              </li>
            ))}
          </ul>
        </Section>
      ))}

      <Section title="Questions">
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
