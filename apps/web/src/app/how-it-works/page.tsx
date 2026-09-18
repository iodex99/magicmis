import type { Metadata } from "next";

import {
  ClosingCta,
  Faqs,
  MarketingHeader,
  MidCta,
  ReadNext,
  Section,
  TourVideo,
  WideSection,
} from "@/components/Marketing";
import { PublicShell } from "@/components/PublicShell";
import {
  ArticleSchema,
  BreadcrumbSchema,
  FaqSchema,
  VideoSchema,
  type Faq,
} from "@/components/StructuredData";
import { PRODUCT_NAME } from "@/lib/brand";
import { pageMetadata } from "@/lib/seo";

const PATH = "/how-it-works";
export const metadata: Metadata = pageMetadata(PATH);

/** The mechanism, in enough detail that a sceptical reader can decide. */

const STAGES: readonly {
  n: string;
  title: string;
  body: string;
  detail: string;
}[] = [
  {
    n: "01",
    title: "Upload your raw data",
    body: "You add the raw data from your accounting system, in any format. They are encrypted as they arrive, used only for the runs you pay for, and deleted automatically.",
    detail:
      "Before you pay for anything, the screen shows file names, sizes, sheet counts and row counts. Not what is in them: no sheet recognition, no mapping preview, no data-quality findings. Those are results, and results appear inside a paid action.",
  },
  {
    n: "02",
    title: "Ledgers are matched to a canonical schema",
    body: "Each ledger is matched to a standard MIS head for you, and the mapping is kept for this company so later months reuse it.",
    detail:
      "Matching is by header name, never by column position, so a reordered file does not break it. Where a name is unambiguous it is matched deterministically without any model involved; only genuinely ambiguous ledgers go to the AI, and anything it cannot place is shown as Unmapped rather than guessed.",
  },
  {
    n: "03",
    title: "The engine computes, then the model writes",
    body: "Every figure in the workbook comes from a deterministic engine. The model writes the commentary around those figures and never produces a number itself.",
    detail:
      "Commentary is generated with placeholders where figures belong, and the engine fills them. That is why a sentence cannot disagree with the table above it — the sentence does not contain a number until the engine puts one there.",
  },
  {
    n: "04",
    title: "The workbook is validated before you see it",
    body: "A series of checks runs against the output: the trial balance ties, the statements agree, the ratios reconcile to their inputs.",
    detail:
      "A failed check stops the job rather than shipping a workbook with a quiet error in it. Where a check fails because the data is incomplete, it says which ledger is missing.",
  },
  {
    n: "05",
    title: "Next month reuses everything",
    body: "Load the new trial balance. If the ledger structure has not changed, the refresh makes no AI calls at all.",
    detail:
      "New or renamed ledgers are flagged for you to place; everything else carries forward. This is the property the whole design is arranged around, and it is what makes a monthly refresh cost a fraction of the first setup.",
  },
];

const FAQS: readonly Faq[] = [
  {
    question: "What does the AI actually do?",
    answer:
      "It proposes ledger mappings where a name is ambiguous, and it writes commentary around figures the engine computed. It never computes, adjusts or writes a number, and it never sees your raw files — only redacted structural profiles and aggregates the server sends for that specific action.",
  },
  {
    question: "Why does a monthly refresh cost less than the first setup?",
    answer:
      "Because it does less. The expensive part of the first month is establishing the mapping. On a refresh where the ledger structure is unchanged, that work is reused and no AI call is made — so the price reflects computation and validation rather than model usage.",
  },
  {
    question: "Can I correct a mapping the product got wrong?",
    answer:
      "Yes, and your correction is the record from then on. The mapping is versioned per company, so a later month reuses your decision rather than re-proposing the original one.",
  },
  {
    question: "What happens if a check fails?",
    answer:
      "The job stops and tells you which check failed and why. A workbook that does not tie is worse than no workbook, because it is a report someone will act on.",
  },
  {
    question: "Do I have to confirm before being charged?",
    answer:
      "Always. The price of an action is shown before it runs and the confirmation is the thing that starts it. There is no path where analysis, mapping results or output appear without a charge being captured or held first.",
  },
];

export default function HowItWorksPage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />
      <VideoSchema path={PATH} />

      <MarketingHeader
        path={PATH}
        eyebrow="How it works"
        heading="Five stages, and what happens in each"
        intro="The interesting part of this product is not that it produces a workbook. It is where the numbers come from, what the model is allowed to touch, and why the second month costs so much less than the first."
      />

      <WideSection
        title="Watch it once"
        intro="The whole thing, end to end, before reading the detail below."
      >
        <TourVideo />
      </WideSection>

      <Section>
        <ol className="flex flex-col gap-6">
          {STAGES.map((stage) => (
            <li
              key={stage.n}
              className="rounded-xl border border-neutral-200/80 bg-surface p-6"
            >
              <div className="flex items-baseline gap-3">
                <span className="text-[0.8125rem] font-semibold tabular-nums text-accent-700">
                  {stage.n}
                </span>
                <h2 className="text-[1.125rem] font-semibold tracking-tight text-neutral-900">
                  {stage.title}
                </h2>
              </div>
              <p className="mt-3 leading-relaxed text-neutral-700">{stage.body}</p>
              <p className="mt-3 border-l-2 border-neutral-200 pl-4 text-[0.9375rem] leading-relaxed text-neutral-500">
                {stage.detail}
              </p>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="The rule the rest follows from">
        <p>
          The AI never outputs a number. Every figure in every workbook, dashboard,
          commentary line and chat answer is computed by the deterministic engine and
          inserted through a placeholder.
        </p>
        <p>
          That constraint is why the commentary can be trusted at the same level as the
          table: they are the same figures, from the same computation, and there is no
          path by which a model-written digit reaches a report. It is also why{" "}
          {PRODUCT_NAME} can show the lineage of any number on demand — the number has a
          provenance because it was computed rather than written.
        </p>
      </Section>

      <MidCta />

      <Section title="Questions">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext paths={["/product", "/security", "/pricing"]} />
      <ClosingCta />
    </PublicShell>
  );
}
