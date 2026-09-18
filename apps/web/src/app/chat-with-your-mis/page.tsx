import Link from "next/link";
import type { Metadata } from "next";

import {
  AlsoCalled,
  ClosingCta,
  Faqs,
  MarketingHeader,
  MidCta,
  ReadNext,
  Section,
  Steps,
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

const PATH = "/chat-with-your-mis";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "Chat with MIS", "chat with your financial data", "chat with Tally data", "MIS chatbot",
 * "ask your management accounts a question" (ADR 0041). The tools that rank for these let a
 * model read a query result and say a number. The page's whole argument is the one thing
 * this product does differently: the model never says a number at all.
 */

const QUESTIONS: readonly string[] = [
  "Why did gross margin fall this month?",
  "Which expenses grew the most against last quarter, and why?",
  "Which customers make up most of the overdue receivables?",
  "What does working capital look like compared with March?",
  "How much of the revenue growth came from the top five customers?",
  "Add a box comparing revenue and profit with the same month last year.",
];

const STEPS: readonly {
  title: string;
  body: string;
  icon: "chat" | "search" | "check";
}[] = [
  {
    title: "You ask in plain English",
    body: "About any figure on the dashboard or in the MIS: a movement, a ratio, a customer, a month. No query language and no report builder.",
    icon: "chat",
  },
  {
    title: "The engine does the arithmetic",
    body: "The question becomes a guarded, read-only query over the months you have loaded, or a metric the engine already computes. The model decides what to look up. It never does the sum.",
    icon: "search",
  },
  {
    title: "The answer arrives with its working",
    body: "The sentence is written with gaps where the figures belong, and the engine fills them. Click any number to see the formula and the ledgers behind it.",
    icon: "check",
  },
];

const FAQS: readonly Faq[] = [
  {
    question: "Is this ChatGPT reading my accounts?",
    answer:
      "No. A general chatbot reads what you paste and produces numbers the same way it produces words — plausibly. Here the model never outputs a figure. It chooses what to look up and writes the sentence around placeholders; a deterministic engine computes every number from your own loaded data and inserts it. A sentence cannot disagree with the MIS, because the number in it came from the MIS.",
  },
  {
    question: "Can I chat with my Tally, QuickBooks or Xero data?",
    answer:
      "You chat with the MIS built from it. You upload the raw trial balance — and ledgers, registers or ageing reports if you want questions at that depth — from Tally, QuickBooks, Xero, Sage, Zoho Books or anything else, and ask about the months you have loaded. There is no live connection to your accounting system, by design: nothing holds standing access to your books.",
  },
  {
    question: "Can it get a number wrong?",
    answer:
      "The figures are computed by the same engine that builds the workbook, and every one links to its lineage, so you can check any of them in a click. What the model can do is misread a question. When that happens the answer shows which figure it looked up, so a wrong lookup is visible rather than hidden inside a confident sentence.",
  },
  {
    question: "What happens if I ask something it cannot answer?",
    answer:
      "It says so rather than guessing. A question outside the MIS — a forecast, tax advice, something about data you have not loaded — is declined with the reason. Declining accurately still takes a call to the model, so a declined message uses credits like any other.",
  },
  {
    question: "What does a question cost?",
    answer:
      "Each message uses prepaid credits, by the kind of question: a quick answer costs the least, digging through ledgers and parties costs more. You choose how hard it thinks — Efficient, Professional or Expert — and there is no subscription.",
  },
  {
    question: "Can it change the dashboard as well as answer questions?",
    answer:
      "Yes, and that is how the dashboard is built. Say what you want on it — a comparison box, a trend against last year, a formula of your own, a card renamed or moved — and it appears beside the chat as the reply arrives, saved for that company, with Undo on every change. The chat writes the layout and the formula; the engine computes every figure.",
  },
];

export default function ChatWithYourMisPage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Chat with the MIS"
        heading="Chat with your MIS — and get answers where every number is computed, not written"
        intro="Ask your financial data a question in plain English: why a margin moved, which customers are overdue, what changed against last quarter. The answer comes back in a sentence, with each figure computed from your own books and one click from its source."
      />
      <AlsoCalled path={PATH} />

      <Section title="What you can ask">
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {QUESTIONS.map((q) => (
            <li
              key={q}
              className="rounded-xl border border-neutral-200/80 bg-surface px-4 py-3 text-[0.9375rem] text-neutral-800"
            >
              {q}
            </li>
          ))}
        </ul>
        <p>
          It sits beside the dashboard, so a question can start from a number you are
          looking at: press <em>Investigate</em> on any card and the question is written
          for you.
        </p>
      </Section>

      <Section title="How an answer is built">
        <Steps steps={STEPS} />
      </Section>

      <Section title="Why “chat with your data” usually goes wrong, and why this does not">
        <p>
          Most chat-with-your-data tools work the same way: the model writes a query,
          reads the result, and then <em>tells you</em> the number. That last step is the
          problem. A language model restating a figure can round it, transpose it, or
          blend it with another — and the sentence sounds equally sure either way. In
          finance, a confident wrong number is worse than no answer.
        </p>
        <p>
          {PRODUCT_NAME} removes the step. The model never emits a digit. It writes “gross
          margin fell to <span className="num">[figure]</span>” and the engine that built
          your MIS fills the gap, from the same computed set of figures as the workbook
          and the dashboard. That is also why every number in an answer is a link: there
          is always a formula and a list of ledgers behind it, because a calculation
          produced it and not a paragraph. The full split between what the AI does and
          never does is on{" "}
          <Link href="/ai-mis-report" className="text-accent-700 hover:underline">
            MIS with AI
          </Link>
          .
        </p>
      </Section>

      <Section title="What it will not do">
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>
            Forecast, advise on tax, or answer about data you have not loaded. It says so
            instead.
          </li>
          <li>
            See a whole file, or your parties’ names. Queries run on our server over your
            encrypted data; the model receives the question, redacted results and nothing
            else. See{" "}
            <Link href="/security" className="text-accent-700 hover:underline">
              security and data handling
            </Link>
            .
          </li>
          <li>
            Write to your books. It reads the months you loaded, and the only thing it can
            change is your own dashboard, where every change can be undone.
          </li>
        </ul>
      </Section>

      <MidCta />

      <Section title="Questions people ask">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext
        paths={["/boardroom-ready-mis", "/mis-dashboard", "/ai-variance-analysis"]}
      />
      <ClosingCta
        heading="Ask your own month a question"
        body={`Create an account, add a company, and drop in last month's raw trial balance. ${PRODUCT_NAME} builds the MIS — then you can chat with it.`}
      />
    </PublicShell>
  );
}
