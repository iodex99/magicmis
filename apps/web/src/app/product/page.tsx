import Link from "next/link";
import type { Metadata } from "next";

import { Donut, MiniBars, Sparkline } from "@/components/Charts";
import { Icon } from "@/components/Icon";
import {
  ClosingCta,
  FictionalNote,
  MarketingHeader,
  ReadNext,
  Section,
  WideSection,
} from "@/components/Marketing";
import { PublicShell } from "@/components/PublicShell";
import { ArticleSchema, BreadcrumbSchema } from "@/components/StructuredData";
import { PRODUCT_NAME } from "@/lib/brand";
import { pageMetadata } from "@/lib/seo";

const PATH = "/product";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * What the output actually looks like.
 *
 * Rendered with the same chart components the app uses, on invented figures (SPEC §2.3
 * permits marketing samples on fictional data only). It is a demonstration rather than a
 * screenshot, so it stays truthful as the product changes and never shows a real account.
 */

/** A fictional trading company's year. Invented; see the note under the sample. */
const REVENUE = [98, 104, 96, 112, 119, 108, 124, 131, 122, 136, 128, 143];
const MARGIN = [31.2, 31.8, 30.4, 32.1, 32.6, 31.9, 32.8, 33.1, 32.4, 33.4, 32.6, 33.7];
const AGEING = [
  { percent: 62, tone: "accent" as const },
  { percent: 21, tone: "muted" as const },
  { percent: 17, tone: "warning" as const },
];

const DELIVERABLES: readonly {
  title: string;
  body: string;
  icon: "table" | "chart" | "file" | "search";
}[] = [
  {
    icon: "table",
    title: "An Excel workbook with live formulas",
    body: "Not an image and not a locked file. The statements calculate in the sheet, so you can extend it, add a schedule, or change a presentation and have it recompute.",
  },
  {
    icon: "chart",
    title: "A dashboard",
    body: "Revenue and margin trend, working-capital days, ageing and liquidity — the views management asks for, in the company's own currency and number format — thousands and millions, or lakhs and crores.",
  },
  {
    icon: "file",
    title: "Written commentary",
    body: "Short paragraphs on what moved and why. Every figure in a sentence was computed by the engine and inserted through a placeholder, never written by the model.",
  },
  {
    icon: "search",
    title: "Lineage on every number",
    body: "Open any figure and see the ledgers and vouchers behind it. A number you cannot trace is a number you cannot defend in the meeting it was prepared for.",
  },
];

function SampleCard({
  label,
  value,
  sub,
  children,
}: {
  label: string;
  value: string;
  sub: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-neutral-200/80 bg-surface p-5">
      <p className="text-[0.75rem] font-medium tracking-wide text-neutral-500 uppercase">
        {label}
      </p>
      <p className="mt-2 text-[1.75rem] leading-none font-semibold tabular-nums text-neutral-900">
        {value}
      </p>
      <p className="mt-2 text-[0.8125rem] text-neutral-500">{sub}</p>
      {children === undefined ? null : <div className="mt-4">{children}</div>}
    </div>
  );
}

export default function ProductPage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />

      <MarketingHeader
        path={PATH}
        eyebrow="The output"
        heading="What you get each month"
        intro="One workbook, one dashboard, one commentary — and a mapping that means next month takes minutes rather than a morning. Here is the shape of it, on invented figures."
      />

      <WideSection
        title="The dashboard"
        intro="Rendered with the same components the product uses. The company is made up. Its currency and number format follow the company being reported — dollars and thousands here, pounds, euros or lakhs and crores elsewhere."
      >
        <div className="mx-auto max-w-[1000px]">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SampleCard label="Revenue" value="$1.43M" sub="This month · up 11.7% YoY">
              <Sparkline values={REVENUE} />
            </SampleCard>
            <SampleCard label="Gross margin" value="33.7%" sub="Up 1.1 pts on last month">
              <Sparkline values={MARGIN} />
            </SampleCard>
            <SampleCard label="Debtor days" value="58" sub="Improved from 64">
              <MiniBars values={[64, 63, 61, 60, 59, 58]} />
            </SampleCard>
            <SampleCard label="Receivables ageing" value="$842K" sub="62% current">
              <div className="flex items-center gap-4">
                <Donut parts={AGEING} size={64} thickness={9} />
                <ul className="flex flex-col gap-1 text-[0.75rem] text-neutral-500">
                  <li>62% current</li>
                  <li>21% 30–60 days</li>
                  <li>17% over 60 days</li>
                </ul>
              </div>
            </SampleCard>
          </div>

          <div className="mt-4 rounded-xl border border-neutral-200/80 bg-surface p-6">
            <div className="flex items-center gap-2 text-[0.75rem] font-medium tracking-wide text-neutral-500 uppercase">
              <Icon name="file" size={14} />
              Commentary
            </div>
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-neutral-700">
              Revenue of $1.43M was 11.7% above the same month last year, with gross
              margin improving 1.1 points to 33.7% as the cost of traded goods fell.
              Debtor days shortened from 64 to 58, releasing working capital, though 17%
              of receivables are now over 60 days and concentrated in three accounts.
            </p>
            <p className="mt-3 text-[0.8125rem] text-neutral-500">
              Every figure in that paragraph was computed by the engine and inserted
              through a placeholder. The model wrote the sentences around them and never a
              number.
            </p>
          </div>

          <FictionalNote />
        </div>
      </WideSection>

      <Section title="What is in the file">
        <ul className="flex flex-col gap-4">
          {DELIVERABLES.map((d) => (
            <li
              key={d.title}
              className="flex gap-4 rounded-xl border border-neutral-200/80 bg-surface p-5"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-700">
                <Icon name={d.icon} size={18} />
              </span>
              <div>
                <h3 className="text-[0.9375rem] font-semibold text-neutral-900">
                  {d.title}
                </h3>
                <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-neutral-600">
                  {d.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Chat with the MIS">
        <p>
          The workbook is not the end of it. You can ask about the month in plain language
          — why a margin moved, which accounts drive the ageing, what changed against last
          quarter — and the answer is computed from your own loaded data, with the query
          that produced it attached.{" "}
          <Link href="/chat-with-your-mis" className="text-accent-700 hover:underline">
            How chatting with your MIS works
          </Link>
          .
        </p>
        <p>
          Chatting with the MIS costs credits per message, by the kind of question, like
          every other action. An out-of-scope question is declined rather than guessed at,
          and the decline is charged, because refusing accurately still costs a call.
        </p>
      </Section>

      <Section title="Recreating a report you already use">
        <p>
          Most firms already have a format the client expects. Point {PRODUCT_NAME} at
          last month&rsquo;s workbook and it reproduces that layout — the same sections,
          the same row order, the same headings — bound to your ledgers so it refreshes.
        </p>
        <p>
          It recreates; it does not redesign, and it will not quietly improve a report you
          did not ask it to change.
        </p>
      </Section>

      <ReadNext paths={["/how-it-works", "/mis-report-format", "/pricing"]} />
      <ClosingCta />
    </PublicShell>
  );
}
