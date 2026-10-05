import type { Metadata } from "next";
import Link from "next/link";

import { QuestionHeader } from "@/components/Answer";
import { ClosingCta, ReadNext, Section } from "@/components/Marketing";
import { PublicShell } from "@/components/PublicShell";
import { ArticleSchema, BreadcrumbSchema } from "@/components/StructuredData";
import { PRODUCT_NAME } from "@/lib/brand";
import { pageMetadata } from "@/lib/seo";

const PATH = "/is-it-safe-to-upload-financial-statements-to-chatgpt";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * One question, one page (ADR 0079), in the words people type. ChatGPT is described only from
 * its maker's own help pages, read on 2026-10-05 (help.openai.com articles 7730893, 5722486,
 * 8914046 and 8983778, and openai.com/business-data — each statement in MAKER_SAYS is on one of
 * them; re-read before changing a word), and its maker is never named on the page: the site names
 * no AI company at all (ADR 0042), ours or anyone else's. What is said about this product is the
 * security page's own wording (ADR 0047, ADR 0048): the server processes the files, so what
 * is promised is who can open one, because that is the promise that holds.
 */

const MAKER_SAYS: readonly string[] = [
  "On the plans for individuals, conversations may be used to train its models unless you switch off “Improve the model for everyone” under Settings, then Data controls. The setting applies to your whole account, on every device.",
  "Rating a reply with a thumbs up or down can send that whole conversation for model improvement, even with the setting off.",
  "On the business plans — Business, Enterprise and Edu — inputs and outputs are not used for training by default.",
  "A temporary chat is not used for training and stays out of your history, but a copy may be kept for up to 30 days for safety.",
  "A deleted chat or file is scheduled for permanent deletion within 30 days, unless it has to be kept longer for security or legal reasons. A file saved to the library is not deleted with the chat that used it.",
];

const BEFORE_UPLOADING: readonly string[] = [
  "Use a business plan, or switch off model training, before the file goes in.",
  "Take out what names people and accounts: customer and supplier names in the debtors and creditors ledgers, employees in the payroll ledgers, bank account numbers and tax identifiers.",
  "Upload a summary rather than the ledger detail where the question allows it.",
  "Check the engagement letter, if the accounts are a client’s, and whether it lets you send them to a general-purpose service.",
  "Delete the chat and the file when you are done, and remember the 30 days.",
];

export default function SafeToUploadPage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />

      <QuestionHeader
        topic="Security"
        topicPath="/security"
        question="Is it safe to upload financial statements to ChatGPT?"
      >
        <p>
          It can be, with care: on a business plan, or with model training switched off,
          and with the names of customers, suppliers and employees taken out first. On the
          personal plans the default is that conversations may be used to train its
          models, and a client&rsquo;s accounts are not yours to share without checking
          your engagement letter.
        </p>
        <p>
          The second risk is the figures. A chat reply that recalculates a statement is
          predicted text, so check every number it gives you against the books.
        </p>
      </QuestionHeader>

      <Section title="What ChatGPT’s maker says happens to what you upload">
        <p>
          Its maker&rsquo;s own help pages, read in October 2026, say this about financial
          data or any other file you share with ChatGPT:
        </p>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          {MAKER_SAYS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p>
          These terms change, and they differ by plan and by workspace. Read the current
          data-controls page for the plan you are on before uploading anything you would
          not want kept.
        </p>
      </Section>

      <Section title="A client’s financial statements carry duties that your own do not">
        <p>
          Professional ethics codes for accountants treat client information as
          confidential, and engagement letters often say where it may be sent. A trial
          balance or a set of statements usually goes further than totals: the debtors and
          creditors ledgers name customers and suppliers, and payroll ledgers can name
          employees. Where those are people, data protection law applies to the upload
          too. None of that makes a chat assistant off-limits. It means the decision to
          upload belongs to whoever is responsible for the data, and it should be made
          before the file is attached, not after.
        </p>
      </Section>

      <Section title="Five things to do before uploading financial data to any chat assistant">
        <ol className="flex list-decimal flex-col gap-2 pl-5">
          {BEFORE_UPLOADING.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </Section>

      <Section title="A safe file can still come back with an unsafe figure">
        <p>
          Asking a chat assistant to total, restate or compare statements means asking a
          language model to do arithmetic. It writes the number that reads most likely,
          which is usually right and occasionally not, and nothing in the reply marks the
          one that is wrong. For explaining a ratio or drafting a note to a director that
          is fine. For a figure that goes into a report, the figure has to come from a
          calculation you can trace back to the ledgers. More on that is in{" "}
          <Link
            href="/can-ai-prepare-financial-statements"
            className="text-accent-700 underline"
          >
            can AI prepare financial statements from a trial balance?
          </Link>
        </p>
      </Section>

      <Section title="No one at a reporting service should be able to open your file">
        <p>
          A tool built for monthly reporting can make narrower promises than a
          general-purpose assistant, and these are the ones {PRODUCT_NAME} makes. Each
          uploaded file is encrypted under a key that belongs to that company alone before
          it is stored. No person at {PRODUCT_NAME} can open a customer&rsquo;s file: no
          screen, tool or staff role does. Every time a file is opened — by a run you
          start, a question you ask or your own download — it is recorded on the
          company&rsquo;s Files and settings page, where you can see it. Deleting the
          company destroys its key, so its files cannot be read again by anyone.
        </p>
        <p>
          The AI receives only what one step needs: the structure of a sheet, a capped
          sample and ledger names, with party and employee names replaced by tokens first.
          It never receives a whole file, it never writes a figure, and your data is not
          used to train AI models. What is not claimed is on the{" "}
          <Link href="/security" className="text-accent-700 underline">
            security page
          </Link>{" "}
          too: there has been no external audit and no certification is held yet.
        </p>
      </Section>

      <ReadNext
        paths={[
          "/security",
          "/can-chatgpt-make-an-mis-report",
          "/ai-financial-reporting",
        ]}
      />
      <ClosingCta
        heading="Report on a client’s month without anyone opening the file"
        body="Create an account, add the company and upload its raw trial balance. Every opening of the file is recorded where you can see it."
      />
    </PublicShell>
  );
}
