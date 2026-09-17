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

const PATH = "/guides/mis-kpis-and-ratios";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "MIS KPIs", "ratios in management accounts", "debtor days formula".
 *
 * The worked figures are invented (SPEC §2.3) and were computed by hand from the inputs shown
 * beside them, so a reader can redo every one. Keep them consistent if any input changes.
 */

interface Ratio {
  readonly name: string;
  readonly formula: string;
  readonly example: string;
  readonly reads: string;
}

/** A fictional 30-day month, in thousands of dollars. */
const INPUTS: readonly [string, string][] = [
  ["Revenue for the month", "420"],
  ["Cost of goods sold", "285"],
  ["Operating expenses before depreciation", "96"],
  ["Trade receivables at month end", "690"],
  ["Inventory at month end", "540"],
  ["Trade payables at month end", "310"],
  ["Current assets", "1,480"],
  ["Current liabilities", "910"],
];

const RATIOS: readonly Ratio[] = [
  {
    name: "Gross margin",
    formula: "Gross profit ÷ revenue × 100",
    example: "135 ÷ 420 = 32.1%",
    reads:
      "What each sale leaves after the direct cost of making or buying it. A fall with steady volumes points at pricing, discounts or input costs.",
  },
  {
    name: "EBITDA margin",
    formula: "EBITDA ÷ revenue × 100",
    example: "39 ÷ 420 = 9.3%",
    reads:
      "Operating profitability before financing and depreciation, so it compares cleanly across months with different borrowing or capital spend.",
  },
  {
    name: "Debtor days (DSO)",
    formula: "Trade receivables ÷ revenue for the period × days in the period",
    example: "690 ÷ 420 × 30 = 49.3 days",
    reads:
      "How long customers take to pay. Rising debtor days with flat sales is cash stuck with customers, and usually the first thing to act on.",
  },
  {
    name: "Inventory days",
    formula: "Inventory ÷ cost of goods sold for the period × days in the period",
    example: "540 ÷ 285 × 30 = 56.8 days",
    reads:
      "How long stock sits before it is sold. Watch it against sales: building stock ahead of a season is a decision, building it without one is a problem.",
  },
  {
    name: "Creditor days (DPO)",
    formula: "Trade payables ÷ cost of goods sold for the period × days in the period",
    example: "310 ÷ 285 × 30 = 32.6 days",
    reads:
      "How long the business takes to pay suppliers. Higher frees cash, but a sharp rise can mean the business cannot pay rather than chooses not to.",
  },
  {
    name: "Cash conversion cycle",
    formula: "Debtor days + inventory days − creditor days",
    example: "49.3 + 56.8 − 32.6 = 73.5 days",
    reads:
      "The days between paying for stock and collecting from the customer — the working capital the business has to finance itself.",
  },
  {
    name: "Current ratio",
    formula: "Current assets ÷ current liabilities",
    example: "1,480 ÷ 910 = 1.63",
    reads:
      "Whether short-term assets cover short-term obligations. The trend matters more than any target figure.",
  },
  {
    name: "Quick ratio",
    formula: "(Current assets − inventory) ÷ current liabilities",
    example: "(1,480 − 540) ÷ 910 = 1.03",
    reads:
      "The current ratio without stock, which cannot always be turned into cash quickly. Below 1 means paying current bills depends on selling inventory.",
  },
];

const FAQS: readonly Faq[] = [
  {
    question: "How many KPIs should a monthly MIS have?",
    answer:
      "Fewer than most do. Six to ten ratios, each shown against the previous month and the same month last year, are read; a page of thirty is skimmed. Start with margins, working-capital days and liquidity, then add the two or three operational measures the business is actually run on.",
  },
  {
    question: "Should debtor days use monthly or annual revenue?",
    answer:
      "Either, as long as the days match: month-end receivables over the month's revenue times the days in the month, or over annual revenue times 365. A single month is volatile for a seasonal business, so many preparers use the last three months' revenue and the days in those three months.",
  },
  {
    question: "Why does my debtor days figure look too high?",
    answer:
      "Usually because receivables include sales tax — GST or VAT — while revenue does not. The two sides then measure different things. Either gross revenue up for tax, or note the basis so the figure is compared like with like from month to month.",
  },
  {
    question: `Which of these ratios does ${PRODUCT_NAME} compute?`,
    answer:
      "All eight on this page: the margins in the profit and loss section, and current ratio, quick ratio, debtor days, creditor days, inventory days and cash conversion cycle in the ratios section, each against the previous month and the same month last year. Every figure is computed by the engine from the mapped trial balance, never by AI.",
  },
];

export default function KpisAndRatiosGuide() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Guide"
        heading="KPIs and ratios for a monthly MIS"
        intro="A ratio is only useful in a monthly report if the reader knows what moved it. Here are the eight that belong in almost every MIS or management accounts pack — the formula, a worked example, and what a change actually tells you."
      />

      <Section>
        <p>
          Every ratio below comes from figures already in the trial balance, which is the
          point: they need no extra data collection, only a mapping of ledgers to report
          heads that stays the same from month to month. Two rules make them worth
          reading. Show each against the previous month and the same month last year, and
          compute them the same way every month — a changed basis looks exactly like a
          changed business.
        </p>
      </Section>

      <WideSection
        title="The inputs for the worked examples"
        intro="One month of a fictional distribution company, in thousands of dollars."
      >
        <div className="mx-auto max-w-[760px]">
          <div className="overflow-x-auto rounded-xl border border-neutral-200/80 bg-surface">
            <table className="w-full border-collapse text-[0.9375rem]">
              <tbody>
                {INPUTS.map(([label, value]) => (
                  <tr key={label} className="border-b border-neutral-100 last:border-0">
                    <th
                      scope="row"
                      className="px-5 py-2.5 text-left font-normal text-neutral-800"
                    >
                      {label}
                    </th>
                    <td className="px-5 py-2.5 text-right text-neutral-900 tabular-nums">
                      {value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <FictionalNote>
            An invented company, not a customer. Gross profit is 420 − 285 = 135, and
            EBITDA is 135 − 96 = 39.
          </FictionalNote>
        </div>
      </WideSection>

      <Section title="The eight ratios">
        <ol className="flex flex-col gap-6">
          {RATIOS.map((ratio, i) => (
            <li key={ratio.name}>
              <h3 className="text-[1rem] font-semibold text-neutral-900">
                {i + 1}. {ratio.name}
              </h3>
              <p className="mt-1.5 text-[0.9375rem] text-neutral-800">
                <span className="text-neutral-500">Formula:</span> {ratio.formula}
              </p>
              <p className="mt-1 text-[0.9375rem] text-neutral-800 tabular-nums">
                <span className="text-neutral-500">Example:</span> {ratio.example}
              </p>
              <p className="mt-2 leading-relaxed text-neutral-600">{ratio.reads}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Mistakes that make ratios lie">
        <p>
          <strong className="font-medium text-neutral-900">Mixing period lengths.</strong>{" "}
          February&rsquo;s debtor days computed with 30 days, or a year-to-date revenue
          against a month-end balance, produce a change that is arithmetic rather than
          business.
        </p>
        <p>
          <strong className="font-medium text-neutral-900">
            Letting the mapping drift.
          </strong>{" "}
          A new ledger posted to &ldquo;other expenses&rdquo; one month and to cost of
          goods sold the next moves gross margin by itself. The mapping is part of the
          ratio.
        </p>
        <p>
          <strong className="font-medium text-neutral-900">
            Reporting a ratio with no comparative.
          </strong>{" "}
          &ldquo;Current ratio 1.63&rdquo; means little; &ldquo;1.63, down from 1.81 last
          month&rdquo; is a question someone can answer.
        </p>
      </Section>

      <Section title="Questions">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext
        paths={[
          "/guides/mis-commentary",
          "/mis-report-format",
          "/guides/debtors-ageing-report",
        ]}
      />
      <ClosingCta
        heading="Have the ratios computed for you, every month"
        body={`${PRODUCT_NAME} computes these from your trial balance with the same mapping each month, shows each against the prior month and last year, and keeps them as live formulas in Excel.`}
      />
    </PublicShell>
  );
}
