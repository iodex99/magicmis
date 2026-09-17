import type { Metadata } from "next";

import {
  ClosingCta,
  Faqs,
  FictionalNote,
  MarketingHeader,
  ReadNext,
  Section,
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

const PATH = "/guides/debtors-ageing-report";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "Debtors ageing report format", "aged debtors report", "accounts receivable aging report".
 * Three names for one report; the page uses each where a reader of that market would.
 * The example is invented (SPEC §2.3) and its rows and columns were checked to add up.
 */

const BUCKETS = ["0–30", "31–60", "61–90", "Over 90"] as const;

const ROWS: readonly [string, readonly [number, number, number, number]][] = [
  ["Northgate Retail", [120, 45, 0, 0]],
  ["Harbour Foods", [80, 60, 35, 0]],
  ["Pinewood Traders", [0, 0, 22, 58]],
  ["Lakeside Stores", [64, 0, 0, 0]],
];

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);
const TOTALS = BUCKETS.map((_, i) => sum(ROWS.map(([, v]) => v[i] ?? 0)));
const GRAND = sum(TOTALS);

const FAQS: readonly Faq[] = [
  {
    question: "Should ageing run from the invoice date or the due date?",
    answer:
      "From the invoice date if customers have different credit terms and you want one consistent picture; from the due date if you want the buckets to mean overdue. Both are defensible. What is not is switching between them, so state the basis on the report.",
  },
  {
    question: "What buckets should a debtors ageing report use?",
    answer:
      "0–30, 31–60, 61–90 and over 90 days is the common default. Match them to your terms: a business selling on 15-day terms learns more from 0–15, 16–30, 31–60 and over 60. Keep the same buckets every month so the report can be compared.",
  },
  {
    question: "How do I treat payments not yet matched to invoices?",
    answer:
      "Show unallocated receipts and credit notes as a separate line, not netted silently against the oldest invoice. Netting makes the ageing look healthier than the collections actually are, and hides the allocation work that still needs doing.",
  },
  {
    question: "Why doesn't my ageing total match the debtors balance?",
    answer:
      "The usual causes are unallocated receipts left out of the ageing, journal entries posted directly to the control ledger without a bill, or invoices dated after the report date. The ageing total should be reconciled to the balance sheet figure every month, with the difference explained.",
  },
  {
    question: `Does ${PRODUCT_NAME} produce ageing reports?`,
    answer:
      "Yes, for receivables and payables, when you load a bills outstanding register alongside the trial balance. Bills are aged by days from bill date to the report date, into buckets set for the company, and bills without a usable date are shown separately rather than guessed.",
  },
];

export default function DebtorsAgeingGuide() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Guide"
        heading="Debtors ageing report: format, buckets and how to read it"
        intro="The ageing report — aged debtors in the UK, accounts receivable aging in the US — is the part of a monthly report that most often turns into an action the same day. Here is how to build one that can be trusted, and what to look for in it."
      />

      <Section title="What it is">
        <p>
          A debtors ageing report splits what customers owe by how long it has been
          outstanding. The total is the same trade receivables figure as on the balance
          sheet; the buckets show whether that balance is healthy. Two businesses with
          identical receivables can be in very different positions if one is mostly under
          thirty days and the other mostly over ninety.
        </p>
      </Section>

      <WideSection
        title="The format"
        intro="Customer by bucket, with totals and the share of the whole in each bucket. Figures in thousands of dollars, for a fictional wholesaler."
      >
        <div className="mx-auto max-w-[900px]">
          <div className="overflow-x-auto rounded-xl border border-neutral-200/80 bg-surface">
            <table className="w-full min-w-[620px] border-collapse text-[0.9375rem]">
              <thead>
                <tr className="border-b border-neutral-200/80 text-[0.8125rem] text-neutral-500">
                  <th scope="col" className="px-5 py-2.5 text-left font-medium">
                    Customer
                  </th>
                  {BUCKETS.map((b) => (
                    <th
                      key={b}
                      scope="col"
                      className="px-5 py-2.5 text-right font-medium"
                    >
                      {b} days
                    </th>
                  ))}
                  <th scope="col" className="px-5 py-2.5 text-right font-medium">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map(([name, values]) => (
                  <tr key={name} className="border-b border-neutral-100">
                    <th
                      scope="row"
                      className="px-5 py-2.5 text-left font-normal text-neutral-800"
                    >
                      {name}
                    </th>
                    {values.map((v, i) => (
                      <td
                        key={BUCKETS[i]}
                        className="px-5 py-2.5 text-right text-neutral-900 tabular-nums"
                      >
                        {v === 0 ? "–" : v}
                      </td>
                    ))}
                    <td className="px-5 py-2.5 text-right font-medium text-neutral-900 tabular-nums">
                      {sum(values)}
                    </td>
                  </tr>
                ))}
                <tr className="border-b border-neutral-100 bg-neutral-50/70 font-medium">
                  <th scope="row" className="px-5 py-2.5 text-left text-neutral-900">
                    Total
                  </th>
                  {TOTALS.map((t, i) => (
                    <td
                      key={BUCKETS[i]}
                      className="px-5 py-2.5 text-right text-neutral-900 tabular-nums"
                    >
                      {t}
                    </td>
                  ))}
                  <td className="px-5 py-2.5 text-right text-neutral-900 tabular-nums">
                    {GRAND}
                  </td>
                </tr>
                <tr className="text-neutral-500">
                  <th scope="row" className="px-5 py-2.5 text-left font-normal">
                    Share
                  </th>
                  {TOTALS.map((t, i) => (
                    <td key={BUCKETS[i]} className="px-5 py-2.5 text-right tabular-nums">
                      {((t / GRAND) * 100).toFixed(1)}%
                    </td>
                  ))}
                  <td className="px-5 py-2.5 text-right tabular-nums">100%</td>
                </tr>
              </tbody>
            </table>
          </div>
          <FictionalNote>
            Invented customers and balances. Nothing here comes from anyone&rsquo;s
            accounts.
          </FictionalNote>
        </div>
      </WideSection>

      <Section title="How to read it">
        <p>
          <strong className="font-medium text-neutral-900">
            Look at the tail first.
          </strong>{" "}
          In the example, one customer accounts for the entire over-90 bucket. That is not
          a collections-process problem; it is a conversation with Pinewood Traders, and
          possibly a provision.
        </p>
        <p>
          <strong className="font-medium text-neutral-900">
            Compare the shares with last month.
          </strong>{" "}
          A total that holds steady while the 31–60 share grows means this month&rsquo;s
          problem is next month&rsquo;s over-90.
        </p>
        <p>
          <strong className="font-medium text-neutral-900">
            Name the largest balances.
          </strong>{" "}
          Most ageing risk sits with a handful of customers. The top five by overdue
          amount, with the last payment date, is usually more useful than the full list.
        </p>
        <p>
          <strong className="font-medium text-neutral-900">
            Read it with debtor days.
          </strong>{" "}
          Debtor days say how long collection takes on average; the ageing says where the
          delay is. Rising debtor days with a clean ageing can simply mean sales rose late
          in the month, which is not a collections problem at all.
        </p>
      </Section>

      <Section title="Questions">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext
        paths={[
          "/guides/mis-kpis-and-ratios",
          "/guides/mis-commentary",
          "/automated-management-accounts",
        ]}
      />
      <ClosingCta
        heading="Ageing in the same buckets, every month"
        body={`${PRODUCT_NAME} ages receivables and payables from your bills register into the same buckets each month, alongside the P&L, balance sheet and ratios in one workbook.`}
      />
    </PublicShell>
  );
}
