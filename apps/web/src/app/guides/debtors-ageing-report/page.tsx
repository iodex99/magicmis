import type { Metadata } from "next";

import {
  ClosingCta,
  Faqs,
  FictionalNote,
  MarketingHeader,
  MidCta,
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
 *
 * Read on 2026-10-05, and the only sources for what this page says about them:
 * - Schedule III as amended by MCA notification G.S.R. 207(E) of 24 March 2021, through ICAI's
 *   Guidance Notes on Division I and Division II (revised January 2022):
 *   https://resource.cdn.icai.org/68981clcgc55147-gnd1.pdf
 *   https://resource.cdn.icai.org/68982clcgc55147-gnd2.pdf
 *   (the MCA and e-Gazette copies could not be fetched).
 * - TallyPrime's receivables report and its ageing key, from Tally Solutions' own help:
 *   https://help.tallysolutions.com/tally-prime/accounting-financial-reports/manage-receivables-outstanding-tally/
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

      <Section title="An ageing report splits what customers owe by how long it has been owed">
        <p>
          A debtors ageing report splits what customers owe by how long it has been
          outstanding. The total is the same trade receivables figure as on the balance
          sheet; the buckets show whether that balance is healthy. Two businesses with
          identical receivables can be in very different positions if one is mostly under
          thirty days and the other mostly over ninety.
        </p>
      </Section>

      <WideSection
        title="The format, with four buckets"
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

      <Section title="An aged receivables report is the same report under another name">
        <p>
          Aged receivables, aged debtors, accounts receivable aging and debtors ageing are
          one report. “Aged receivables” is the name many accounting systems give it, and
          it usually comes in two forms: a summary, with one line per customer as in the
          example above, and a detail version listing every open invoice under its
          customer. The summary goes in the monthly report; the detail is what the person
          chasing payment works from.
        </p>
        <p>
          Whichever name your system uses, export it as at the same date as the trial
          balance, so the aged total can be agreed to the receivables figure on the
          balance sheet.
        </p>
      </Section>

      <Section title="Debtors ageing as per Schedule III runs from the due date, in five periods">
        <p>
          For Indian companies, Schedule III to the Companies Act 2013, as amended by the
          Ministry of Corporate Affairs on 24 March 2021, requires an ageing schedule of
          trade receivables in the financial statements for financial years beginning on
          or after 1 April 2021. The periods are fixed:{" "}
          <strong className="font-medium text-neutral-900">
            less than 6 months, 6 months to 1 year, 1–2 years, 2–3 years, and more than 3
            years
          </strong>
          , counted from the due date of payment — or from the date of the transaction
          where no due date is specified. Unbilled dues are shown separately.
        </p>
        <p>
          The rows split receivables into undisputed and disputed, each as considered good
          or considered doubtful (Division I); companies reporting under Ind AS (Division
          II) show each instead as considered good, which have a significant increase in
          credit risk, or credit impaired. Trade payables have their own schedule, in
          periods of less than 1 year, 1–2 years, 2–3 years and more than 3 years, with
          MSME dues shown apart.
        </p>
        <p>
          That is an annual disclosure, not a management format. The ageing in{" "}
          {PRODUCT_NAME} runs from the bill date into buckets set for the company, for
          reading every month; it is not the Schedule III schedule, which should be
          prepared on the due-date basis the Schedule asks for.
        </p>
      </Section>

      <Section title="Debtors ageing in TallyPrime comes from the Receivables outstanding report">
        <p>
          TallyPrime keeps bill-wise receivables under{" "}
          <strong className="font-medium text-neutral-900">
            Gateway of Tally &gt; Display More Reports &gt; Statements of Accounts &gt;
            Outstandings &gt; Receivables
          </strong>
          . Press{" "}
          <strong className="font-medium text-neutral-900">F6 (Ageing Method)</strong> to
          age by bill date or by due date and to set the ageing periods, then export the
          report with{" "}
          <strong className="font-medium text-neutral-900">Alt+E (Export)</strong> and{" "}
          <strong className="font-medium text-neutral-900">Current</strong>.
        </p>
        <p>
          The ageing is only as good as the bill-wise entries behind it: a receipt posted
          on account rather than against a bill stays unallocated, and the oldest invoices
          look unpaid. Load the export beside the month&rsquo;s trial balance and{" "}
          {PRODUCT_NAME} ages it into the same buckets every month, with bills that have
          no usable date shown separately rather than guessed.
        </p>
      </Section>

      <MidCta />

      <Section title="What people ask about debtors ageing">
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
