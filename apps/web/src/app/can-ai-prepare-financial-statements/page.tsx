import type { Metadata } from "next";
import Link from "next/link";

import { QuestionHeader } from "@/components/Answer";
import { ClosingCta, FictionalNote, ReadNext, Section } from "@/components/Marketing";
import { PublicShell } from "@/components/PublicShell";
import { ArticleSchema, BreadcrumbSchema } from "@/components/StructuredData";
import { PRODUCT_NAME } from "@/lib/brand";
import { pageMetadata } from "@/lib/seo";

const PATH = "/can-ai-prepare-financial-statements";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * One question, one page (ADR 0079): the product's thesis in the West's words, the sibling of
 * `/can-chatgpt-make-an-mis-report`. It names a general chat assistant because that is what
 * people ask about, and nothing this product is built on (ADR 0042). The sign example is
 * invented (SPEC §2.3).
 */

const SPLIT: readonly { task: string; who: string }[] = [
  {
    task: "Recognize which sheet is a trial balance and which columns hold the balances",
    who: "AI, where rules cannot tell",
  },
  {
    task: "Place each ledger under a statement line: revenue, direct costs, receivables, borrowings",
    who: "Rules first, AI for the ledgers rules cannot place, the accountant for the rest",
  },
  {
    task: "Add up each line, apply the signs, roll the profit into the balance sheet",
    who: "Arithmetic, never a language model",
  },
  {
    task: "Prove the statements tie back to the trial balance",
    who: "Arithmetic",
  },
  {
    task: "Explain in words what moved and why",
    who: "AI, with every figure filled in by the arithmetic",
  },
  {
    task: "Judge a provision, an accrual or a disclosure, and sign the accounts",
    who: "An accountant",
  },
];

export default function CanAiPrepareStatementsPage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />

      <QuestionHeader
        topic="AI financial reporting"
        topicPath="/ai-financial-reporting"
        question="Can AI prepare financial statements from a trial balance?"
      >
        <p>
          Part of the job, yes. AI is good at the language work: recognizing the trial
          balance in an export and deciding which statement line each ledger belongs to.
          The figures themselves should come from arithmetic, not from a model, because a
          model writes the number that reads most likely rather than the one the ledgers
          add up to.
        </p>
        <p>
          And what comes out is a set of management statements. Statutory or audited
          accounts still need an accountant&rsquo;s judgement and signature.
        </p>
      </QuestionHeader>

      <Section title="Preparing financial statements is six jobs, and only two of them are language">
        <div className="overflow-x-auto rounded-xl border border-neutral-200/80 bg-surface">
          <table className="w-full min-w-[520px] border-collapse text-[0.9375rem]">
            <thead>
              <tr className="border-b border-neutral-200/80 text-left text-[0.8125rem] text-neutral-500">
                <th scope="col" className="px-4 py-2.5 font-medium">
                  The job
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Who should do it
                </th>
              </tr>
            </thead>
            <tbody>
              {SPLIT.map((row) => (
                <tr key={row.task} className="border-b border-neutral-100 last:border-0">
                  <th
                    scope="row"
                    className="px-4 py-2.5 text-left font-normal text-neutral-800"
                  >
                    {row.task}
                  </th>
                  <td className="px-4 py-2.5 text-neutral-600">{row.who}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Can ChatGPT create financial statements or make a balance sheet?">
        <p>
          It will produce something that looks like one. Paste a trial balance in and ask
          for a profit and loss account and a balance sheet, and the reply is well laid
          out and confident. What it cannot give you is a reason to trust it. A long trial
          balance may be cut short, a ledger can be skipped, and a credit balance can be
          read with the wrong sign — and the balance sheet may still appear to balance,
          because the model can write a total that makes it so.
        </p>
        <p>
          A sales ledger holding a credit balance of (1,550) is revenue of 1,550. Read it
          as a debit and the profit falls by 3,100, twice the balance, with nothing in the
          reply to say so. A calculation catches that; a paragraph does not.
        </p>
        <FictionalNote>
          The balance in this example is invented for illustration.
        </FictionalNote>
        <p>
          Using a chat assistant to explain a ratio, suggest a layout or tidy a note is a
          good use of it. Whether to upload a client&rsquo;s accounts to one at all is its
          own question, answered in{" "}
          <Link
            href="/is-it-safe-to-upload-financial-statements-to-chatgpt"
            className="text-accent-700 underline"
          >
            is it safe to upload financial statements to ChatGPT?
          </Link>
        </p>
      </Section>

      <Section title="Statements you can trust tie back to the trial balance, line by line">
        <p>
          Three checks separate a statement from a draft. The trial balance nets to zero
          before anything is built from it. Every ledger with a balance lands in exactly
          one line, or in a visible Unmapped line, so the statements add back to the trial
          balance total. And the balance sheet balances once the period&rsquo;s profit is
          included. A figure that passes all three, and opens to the ledgers it came from,
          is one you can put in front of a director.
        </p>
      </Section>

      <Section title="Here the AI maps the ledgers and writes the words, and never writes a figure">
        <p>
          {PRODUCT_NAME} splits the work the way the table above does. Rules place the
          ledgers they can, AI suggests a line for the ones they cannot, and anything
          still uncertain is left Unmapped for you rather than guessed. The mapping is
          kept, so next month is a refresh, not a rebuild. Every figure in the workbook,
          on the dashboard and in the commentary is computed by a calculation engine and
          checked against the trial balance. The commentary is drafted with blanks that
          the engine fills, and a draft containing a number of its own is rejected before
          you see it.
        </p>
        <p>
          The full route from an export to the statements is in{" "}
          <Link
            href="/trial-balance-to-financial-statements"
            className="text-accent-700 underline"
          >
            trial balance to financial statements
          </Link>
          .
        </p>
      </Section>

      <ReadNext
        paths={[
          "/can-chatgpt-make-an-mis-report",
          "/ai-financial-reporting",
          "/guides/trial-balance-to-management-report",
        ]}
      />
      <ClosingCta heading="Get statements where AI never writes a number" />
    </PublicShell>
  );
}
