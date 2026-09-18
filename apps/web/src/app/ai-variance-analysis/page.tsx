import Link from "next/link";
import type { Metadata } from "next";

import {
  AlsoCalled,
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

const PATH = "/ai-variance-analysis";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "AI variance analysis", "flux analysis automation", "automated variance commentary",
 * "month-over-month variance explanations" (ADR 0041). American controller vocabulary —
 * "flux" is theirs — for the commentary feature. The guide at /guides/mis-commentary teaches
 * how to write commentary by hand; this page is for the reader who wants it written.
 */

const LINES: readonly { line: string; move: string; why: string }[] = [
  {
    line: "Revenue",
    move: "+6.4% vs last month",
    why: "Wholesale up on two new accounts; retail flat.",
  },
  {
    line: "Gross margin",
    move: "−0.6 pts",
    why: "Shipping and freight rose on flat volume; product cost held.",
  },
  {
    line: "Employee cost",
    move: "+2.1%",
    why: "One hire mid-month; no change in rates.",
  },
  {
    line: "Receivable days",
    move: "−3 days",
    why: "Two overdue balances over 90 days collected.",
  },
];

const FAQS: readonly Faq[] = [
  {
    question: "What is variance analysis, or flux analysis?",
    answer:
      "Comparing each line of the month against a baseline — last month, the same month last year, or year to date — and explaining the movements that matter. US finance teams call the month-over-month version flux analysis. The arithmetic is trivial; the time goes on working out which movements are material and writing a sentence about each that a reader can act on.",
  },
  {
    question: "What does AI do in the variance analysis here?",
    answer:
      "It writes the sentences. The variances themselves — amounts, percentages, which lines cross the materiality threshold — are computed by a deterministic engine from your trial balance. The model drafts commentary around those computed figures with placeholders where numbers belong, the engine fills them in, and a check rejects any draft that contains a number of its own.",
  },
  {
    question: "How does it know which variances are worth explaining?",
    answer:
      "By materiality: only movements above a threshold are included, so the commentary is about the four things that changed the month and not forty lines of noise. Where ledgers or registers are loaded, it can name the accounts or parties that drove a movement rather than only the line.",
  },
  {
    question: "Can I edit the commentary?",
    answer:
      "Yes. It opens as a report you can read, print to PDF for the board pack, or copy into your own document and edit. The figures in it stay linked to their lineage in the app.",
  },
  {
    question: "Does it explain why, or only what?",
    answer:
      "It explains what the books can show: which accounts, parties or months drove a movement. It does not invent a business reason the data cannot support — “freight rose on flat volume” is in the ledgers; “because fuel prices rose” is not, and it will not say it.",
  },
];

export default function AiVarianceAnalysisPage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Variance commentary"
        heading="AI variance analysis that writes the commentary and never touches the numbers"
        intro="Month-over-month and year-over-year variances, computed from your trial balance, filtered to the ones that matter, and written up in plain sentences. The flux analysis you do by hand after every close, done before you have finished your coffee."
      />
      <AlsoCalled path={PATH} />

      <Section title="What comes back">
        <div className="overflow-x-auto rounded-xl border border-neutral-200/80 bg-surface">
          <table className="w-full text-left text-[0.9375rem]">
            <thead>
              <tr className="border-b border-neutral-200/80 text-[0.75rem] tracking-wide text-neutral-500 uppercase">
                <th className="px-4 py-3 font-semibold">Line</th>
                <th className="px-4 py-3 font-semibold">Movement</th>
                <th className="px-4 py-3 font-semibold">What drove it</th>
              </tr>
            </thead>
            <tbody>
              {LINES.map((l) => (
                <tr key={l.line} className="border-b border-neutral-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-neutral-900">{l.line}</td>
                  <td className="num px-4 py-3 text-left whitespace-nowrap text-neutral-700">
                    {l.move}
                  </td>
                  <td className="px-4 py-3 text-neutral-600">{l.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <FictionalNote />
        <p>
          In the product this reads as prose, not a table: a short written review of the
          month, section by section, that opens as a report and prints to PDF. Every
          figure in it is a link to the formula and the ledgers behind it.
        </p>
      </Section>

      <Section title="Computed first, written second">
        <p>
          Asking a chatbot to “analyze the variances” in a pasted trial balance gets you
          fluent paragraphs with numbers the model produced the way it produces words.
          Some will be right. {PRODUCT_NAME} splits the job in two. A deterministic engine
          computes every variance and decides which are material. Only then does the model
          write — around placeholders, never digits — and the engine inserts the figures
          afterwards. A draft containing a number of its own fails a check and is never
          shown.
        </p>
        <p>
          The same figures feed the workbook, the dashboard and{" "}
          <Link href="/chat-with-your-mis" className="text-accent-700 hover:underline">
            the chat
          </Link>
          , so a follow-up question — “which customers?” — is answered from the numbers
          the commentary was written from. To write this kind of commentary yourself, the
          method is in{" "}
          <Link href="/guides/mis-commentary" className="text-accent-700 hover:underline">
            how to write MIS commentary
          </Link>
          .
        </p>
      </Section>

      <Section title="Questions people ask">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext
        paths={[
          "/month-end-reporting-package",
          "/chat-with-your-mis",
          "/guides/mis-commentary",
        ]}
      />
      <ClosingCta
        heading="Have last month written up"
        body="Create an account, add a company, and upload the raw trial balance for a month you have already closed. Read the commentary against what you wrote yourself."
      />
    </PublicShell>
  );
}
