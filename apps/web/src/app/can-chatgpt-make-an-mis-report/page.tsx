import type { Metadata } from "next";
import Link from "next/link";

import { QuestionHeader } from "@/components/Answer";
import { ClosingCta, ReadNext, Section } from "@/components/Marketing";
import { PublicShell } from "@/components/PublicShell";
import { ArticleSchema, BreadcrumbSchema } from "@/components/StructuredData";
import { PRODUCT_NAME } from "@/lib/brand";
import { pageMetadata } from "@/lib/seo";

const PATH = "/can-chatgpt-make-an-mis-report";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * One question, one page (ADR 0079), in the words buyers type. It names a general chat
 * assistant because that is the question; it names nothing this product is built on (ADR 0042).
 */
export default function CanChatGptMakeMisPage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />

      <QuestionHeader
        topic="MIS with AI"
        topicPath="/ai-mis-report"
        question="Can ChatGPT make an MIS report?"
      >
        <p>
          It can draft a format, explain a ratio and write a paragraph. It should not
          produce the figures. A language model writes the number that reads most
          plausibly, which is not always the number your ledgers add up to, and in a
          management report that is the one mistake that matters.
        </p>
        <p>
          The safe split is AI for recognising files and writing sentences, and a
          calculation engine for every figure.
        </p>
      </QuestionHeader>

      <Section title="What a chat assistant is good at in an MIS">
        <p>
          Suggesting a layout, explaining what debtor days or EBITDA mean, turning rough
          notes into a clean paragraph, drafting the questions a director is likely to
          ask. None of that depends on a figure being exactly right, and all of it saves
          time.
        </p>
      </Section>

      <Section title="A figure that reads right and is not">
        <p>
          Paste a trial balance into a chat and ask for a profit and loss, and you get
          one: well laid out, confident, and computed by a model that predicts text rather
          than adding columns. It can drop a ledger, add a credit with the wrong sign or
          round twice, and nothing in the reply tells you. There is no check that the
          trial balance nets to zero and no way to open a figure and see the ledgers
          behind it.
        </p>
        <p>
          Two practical points as well: a long trial balance may not fit in one message,
          and a client&rsquo;s accounts pasted into a general chat tool are handled
          however that tool handles them. Check before you paste.
        </p>
      </Section>

      <Section title="The AI here is not allowed to write a figure">
        <p>
          {PRODUCT_NAME} uses AI for the parts that are language: recognising which sheet
          is a trial balance, placing a ledger that no rule can place, and drafting
          commentary. The commentary is written with blanks, and the calculation engine
          fills every blank from the books. A draft that contains a number of its own is
          rejected before anyone sees it, and every figure in the report opens to the
          ledgers it came from.
        </p>
        <p>
          More on the split is on{" "}
          <Link href="/ai-mis-report" className="text-accent-700 underline">
            MIS with AI
          </Link>
          .
        </p>
      </Section>

      <ReadNext
        paths={[
          "/ai-mis-report",
          "/ai-variance-analysis",
          "/how-to-make-an-mis-report-in-excel",
        ]}
      />
      <ClosingCta heading="See an MIS where AI never writes a number" />
    </PublicShell>
  );
}
