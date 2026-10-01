import type { Metadata } from "next";

import { QuestionHeader } from "@/components/Answer";
import { ClosingCta, FictionalNote, ReadNext, Section } from "@/components/Marketing";
import { PublicShell } from "@/components/PublicShell";
import { ArticleSchema, BreadcrumbSchema } from "@/components/StructuredData";
import { PRODUCT_NAME } from "@/lib/brand";
import { pageMetadata } from "@/lib/seo";

const PATH = "/how-to-calculate-ebitda-in-an-mis-report";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * One question, one page (ADR 0079). The definition is the engine's own (ADR 0020): EBITDA
 * leaves other income out and adds it back between EBITDA and profit before tax. The example
 * is invented (SPEC §2.3) and checked to add up.
 */
const ROWS: readonly [string, string, boolean][] = [
  ["Revenue", "500", false],
  ["Less direct costs", "(300)", false],
  ["Less employee costs", "(80)", false],
  ["Less other operating expenses", "(50)", false],
  ["EBITDA", "70", true],
  ["Add other income", "12", false],
  ["Less depreciation and amortisation", "(15)", false],
  ["Less finance costs", "(9)", false],
  ["Profit before tax", "58", true],
];

export default function EbitdaInMisPage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />

      <QuestionHeader
        topic="KPIs and ratios"
        topicPath="/guides/mis-kpis-and-ratios"
        question="How is EBITDA calculated in an MIS report?"
      >
        <p>
          EBITDA = revenue − direct costs − employee costs − other operating expenses.
        </p>
        <p>
          Interest, tax, depreciation and amortisation are left out by definition. Other
          income, such as interest received or a one-off gain, is left out too, because it
          is not what the operations earned. It goes below EBITDA, on the way to profit
          before tax.
        </p>
      </QuestionHeader>

      <Section title="Other income does not belong in EBITDA">
        <p>
          EBITDA exists to show what the business earns from running itself, before
          financing and accounting choices. Interest on a deposit, a gain on selling a
          vehicle or a one-off grant can lift a weak month into a good one if they are
          added in, and the margin then says something the operations did not do. Keeping
          other income out makes one month comparable with the next.
        </p>
      </Section>

      <Section title="Where it sits on the way to profit before tax">
        <p>
          Profit before tax = EBITDA + other income − depreciation − finance costs −
          exceptional items.
        </p>
        <div className="overflow-x-auto rounded-xl border border-neutral-200/80 bg-surface">
          <table className="w-full min-w-[360px] border-collapse text-[0.9375rem] tabular-nums">
            <thead>
              <tr className="border-b border-neutral-200/80 text-left text-[0.8125rem] text-neutral-500">
                <th scope="col" className="px-4 py-2.5 font-medium">
                  ₹ lakh, one month
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([label, amount, total]) => (
                <tr
                  key={label}
                  className={`border-b border-neutral-100 last:border-0 ${total ? "font-semibold" : ""}`}
                >
                  <th
                    scope="row"
                    className="px-4 py-2 text-left font-[inherit] text-neutral-800"
                  >
                    {label}
                  </th>
                  <td className="px-4 py-2 text-right text-neutral-900">{amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>EBITDA margin = EBITDA ÷ revenue × 100: here 70 ÷ 500, or 14%.</p>
        <FictionalNote />
      </Section>

      <Section title="The same definition every month, for every company">
        <p>
          {PRODUCT_NAME} computes EBITDA this way for every company and every month, with
          other income added back below it on the way to profit before tax. Each figure
          opens to the heads and ledgers it was built from.
        </p>
      </Section>

      <ReadNext
        paths={[
          "/guides/mis-kpis-and-ratios",
          "/how-to-calculate-gross-margin-from-a-trial-balance",
          "/mis-report-format",
        ]}
      />
      <ClosingCta heading="Have EBITDA computed from your trial balance" />
    </PublicShell>
  );
}
