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

const PATH = "/ai-mis-report";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "AI MIS report", "MIS with AI", "AI MIS generator", "AI management accounts".
 *
 * The honest answer to these searches is also the differentiator: the obvious way to put AI
 * on an MIS — hand it the ledger and ask for a report — produces numbers nobody can trust.
 * The page says plainly where AI is used and where it is not (SPEC §2.7), and makes no claim
 * the code does not enforce.
 */

const DOES: readonly { title: string; body: string }[] = [
  {
    title: "Recognises what you loaded",
    body: "Which sheet is the trial balance, which is a bills register, which column holds the closing balance — from the structure of the file, whatever system exported it.",
  },
  {
    title: "Maps the ledgers nothing else could",
    body: "Your confirmed mapping, a library of common ledger names and the ledger's group are tried first. AI proposes a report head only for what is left, and marks it for your review.",
  },
  {
    title: "Drafts the commentary",
    body: "Sentences explaining the month's material movements, with a placeholder wherever a figure belongs. The engine fills the placeholders; the draft is rejected if it contains a number of its own.",
  },
  {
    title: "Answers questions about the report",
    body: "Ask why margin fell or which customers are overdue. The answer is worked out by queries against your report data, and every figure in it comes from those query results.",
  },
];

const DOES_NOT: readonly string[] = [
  "Calculate, round or restate any figure. Totals, ratios and variances come from a deterministic engine and are the same every time.",
  "See your raw files. They are processed in your browser; AI receives redacted structure, a small limited sample and totals, for a paid action you confirmed.",
  "Run on a routine month. When the ledger structure has not changed, the monthly refresh makes no AI calls at all.",
  "Choose its own model or budget. Those are fixed on the server for each action, and the price is shown before anything runs.",
];

const FAQS: readonly Faq[] = [
  {
    question: "Can AI prepare an MIS report?",
    answer:
      "AI can do the parts of the work that are judgement about text — recognising files, matching ledger names to report heads, drafting commentary. It should not do the arithmetic. A language model asked to produce figures can produce ones that look right and are not, and in a financial report that is the one failure that matters.",
  },
  {
    question: "How do I know the numbers in an AI-generated report are right?",
    answer: `In ${PRODUCT_NAME} no number is AI-generated. Every figure is computed by the engine from your mapped trial balance, the report is checked to tie back to it, and any figure can be traced to the ledgers behind it.`,
  },
  {
    question: "Is my financial data used to train AI models?",
    answer:
      "No. AI requests are sent to Anthropic, which does not use API data to train its models by default. And what is sent is already redacted in your browser: party names and identifiers are replaced with tokens before anything leaves it.",
  },
  {
    question: "Does it work with my accounting system?",
    answer:
      "It works from exports rather than a live connection, so any system that can export a trial balance to Excel or CSV can be used. Tally exports are recognised in detail, including their group structure.",
  },
];

export default function AiMisReportPage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="MIS with AI"
        heading="An AI MIS report generator that never writes the numbers"
        intro="Most of the time spent on a monthly MIS is judgement about text: which sheet is which, which ledger belongs where, what to say about the month. That is what AI is good at. The figures are a different matter — so in this product, AI never produces one."
      />

      <Section title="What AI does">
        <div className="grid gap-4 sm:grid-cols-2">
          {DOES.map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-neutral-200/80 bg-white p-5"
            >
              <h3 className="text-[0.9375rem] font-semibold text-neutral-900">
                {item.title}
              </h3>
              <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-neutral-600">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="What AI does not do">
        <ul className="flex list-disc flex-col gap-2.5 pl-5">
          {DOES_NOT.map((line) => (
            <li key={line} className="leading-relaxed">
              {line}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Why it is built this way">
        <p>
          A report that is right nineteen months out of twenty is not a report anyone can
          sign off. Keeping AI to recognition, mapping proposals and wording — and keeping
          every figure in a deterministic engine — means the parts that must be exact are
          exact, and the parts that need judgement are shown to you before they are used.
        </p>
        <p>
          It is also why the product gets cheaper to run after the first month. Once the
          mapping is confirmed, the refresh is arithmetic, and arithmetic needs no AI.
        </p>
      </Section>

      <Section title="Questions">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext paths={["/mis-in-minutes", "/how-it-works", "/security"]} />
      <ClosingCta
        heading="See it on your own month"
        body="Create an account, load a trial balance, and see the price of the report before anything runs."
      />
    </PublicShell>
  );
}
