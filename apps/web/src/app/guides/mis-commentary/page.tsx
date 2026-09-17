import type { Metadata } from "next";

import {
  ClosingCta,
  Faqs,
  FictionalNote,
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

const PATH = "/guides/mis-commentary";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "MIS commentary examples", "variance analysis commentary", "management accounts
 * commentary". The before-and-after sentences use invented figures (SPEC §2.3).
 */

const PAIRS: readonly { weak: string; strong: string; why: string }[] = [
  {
    weak: "Revenue for the month was $1.42m.",
    strong:
      "Revenue rose 11% on the same month last year to $1.42m, almost all from the two new distributor accounts opened in the quarter.",
    why: "The table already says $1.42m. The sentence earns its place by saying compared with what, and why.",
  },
  {
    weak: "Gross margin decreased due to various factors.",
    strong:
      "Gross margin fell 2.1 points to 31.4% as freight costs rose; prices were not changed.",
    why: "“Various factors” is an admission that nobody looked. Name the cause, or say it is not yet known.",
  },
  {
    weak: "Debtors increased significantly, which is concerning.",
    strong:
      "Debtor days rose from 48 to 57. Two customers account for most of the rise; both have agreed payment dates this month.",
    why: "Adjectives are opinions. The figure, the cause and what is being done about it are information.",
  },
];

const FAQS: readonly Faq[] = [
  {
    question: "Which variances should the commentary explain?",
    answer:
      "Those above a threshold agreed with the reader — for example, any line that moved by more than 10% and more than a fixed amount against the comparative. Both conditions matter: a percentage alone flags tiny lines, an amount alone ignores large swings in small ones.",
  },
  {
    question: "Should commentary compare with last month or last year?",
    answer:
      "Profit and loss lines are best compared with the same month last year, because seasonality makes month-on-month movements noisy. Balance sheet and working-capital measures are best compared with the previous month end, because that is what the business can act on now.",
  },
  {
    question: "How long should MIS commentary be?",
    answer:
      "Short enough to be read before the meeting. A few sentences per section, each explaining a material movement, is usually right. If a movement needs a page, it deserves its own note.",
  },
  {
    question: `Does ${PRODUCT_NAME} use AI to write the commentary?`,
    answer:
      "AI drafts the sentences, but it never writes a number. Every figure in the commentary is computed by the engine and inserted into the sentence afterwards, and a check rejects any draft that contains a figure of its own. Where the data does not support a conclusion, the commentary says so rather than guessing.",
  },
];

export default function CommentaryGuide() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Guide"
        heading="MIS commentary and variance analysis that gets read"
        intro="The tables in a monthly report say what happened. The commentary is the only part that says why — and it is the part most often skipped, written last, or reduced to reading the table aloud. Here is how to write it well."
      />

      <Section title="What commentary is for">
        <p>
          A reader of a management report has a few minutes and one question: is anything
          here I need to act on? Commentary answers that by picking out the movements that
          matter, explaining each, and saying what happens next. If a sentence could be
          deleted without the reader losing anything, it was a caption.
        </p>
      </Section>

      <Section title="A method that works">
        <ol className="flex list-decimal flex-col gap-3 pl-5">
          <li>
            <strong className="font-medium text-neutral-900">Set a threshold.</strong>{" "}
            Agree which movements need a sentence — a percentage and an amount — so the
            commentary is consistent and nobody has to decide each month.
          </li>
          <li>
            <strong className="font-medium text-neutral-900">List the variances.</strong>{" "}
            Every line over the threshold, against the right comparative: the same month
            last year for profit and loss, the previous month end for the balance sheet.
          </li>
          <li>
            <strong className="font-medium text-neutral-900">Find the cause.</strong>{" "}
            Price, volume, mix, timing, a one-off, or a classification change. Timing and
            reclassification are worth ruling out first; they explain a surprising share
            of large movements.
          </li>
          <li>
            <strong className="font-medium text-neutral-900">
              Write one sentence each.
            </strong>{" "}
            The movement, the figure, the cause. Add what is being done only when
            something is.
          </li>
          <li>
            <strong className="font-medium text-neutral-900">
              Lead with what matters most.
            </strong>{" "}
            Order by impact, not by the order of lines in the table.
          </li>
        </ol>
      </Section>

      <Section title="Weak and strong, side by side">
        <ul className="flex flex-col gap-5">
          {PAIRS.map((pair) => (
            <li
              key={pair.weak}
              className="rounded-xl border border-neutral-200/80 bg-surface p-5"
            >
              <p className="text-[0.9375rem] text-neutral-500 line-through decoration-neutral-300">
                {pair.weak}
              </p>
              <p className="mt-2 text-[0.9375rem] font-medium text-neutral-900">
                {pair.strong}
              </p>
              <p className="mt-2 text-[0.875rem] leading-relaxed text-neutral-600">
                {pair.why}
              </p>
            </li>
          ))}
        </ul>
        <FictionalNote>
          The companies and figures in these sentences are invented for illustration.
        </FictionalNote>
      </Section>

      <Section title="Words to avoid">
        <p>
          &ldquo;Significantly&rdquo;, &ldquo;substantially&rdquo; and
          &ldquo;concerning&rdquo; without a figure. &ldquo;Due to various factors&rdquo;.
          &ldquo;In line with expectations&rdquo; when no expectation was written down.
          And any figure in the commentary that does not appear in, or follow directly
          from, the tables — a number the reader cannot trace is a number they cannot
          trust.
        </p>
      </Section>

      <Section title="Questions">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext
        paths={["/guides/mis-kpis-and-ratios", "/ai-mis-report", "/mis-report-format"]}
      />
      <ClosingCta
        heading="Commentary where every figure is computed"
        body={`${PRODUCT_NAME} drafts commentary on the movements in your month, with every number inserted by the engine from the report itself — never written by AI.`}
      />
    </PublicShell>
  );
}
