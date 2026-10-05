import type { Metadata } from "next";
import Link from "next/link";

import {
  ClosingCta,
  Faqs,
  FictionalNote,
  MarketingHeader,
  MidCta,
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

const PATH = "/guides/management-accounts-commentary-examples";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "Management accounts commentary examples", "P&L commentary examples", "variance analysis
 * commentary example", "how to explain variances in monthly financial statements". The British
 * sibling of `/guides/mis-commentary`, which is written in India's words; the two link to each
 * other and share no sentences. Every company and figure is invented (SPEC §2.3), and each
 * rewrite's arithmetic is checked to add up.
 */

const PAIRS: readonly {
  line: string;
  company: string;
  weak: string;
  strong: string;
  why: string;
}[] = [
  {
    line: "Turnover — price",
    company: "Harlow & Pike, a kitchenware wholesaler",
    weak: "Turnover was £612,000 this month, which is up on last year.",
    strong:
      "Turnover rose 9% on May last year to £612,000. Volumes rose 1%; the rest is the 8% list-price increase from 1 April holding, with no customer lost over it.",
    why: "Up on last year is visible in the table. The reader needs to know whether more was sold or the same was sold for more, because only one of those lasts.",
  },
  {
    line: "Gross margin — input costs",
    company: "Fenwick Joinery",
    weak: "Gross margin was down this month due to cost pressures.",
    strong:
      "Gross margin fell 3.5 points to 30.5%. Timber rose 12% in February, and the fixed-price contracts signed in the autumn cannot pass it on; the two largest end in June.",
    why: "“Cost pressures” names no cost. The rewrite says which cost, why the price could not follow it, and when that stops.",
  },
  {
    line: "Gross margin — mix",
    company: "Brightwater Dental Group",
    weak: "Revenue held steady, but profit was lower than last month.",
    strong:
      "Revenue was flat at £284,000, but gross margin fell 2.4 points to 41.2%: hygiene appointments, the lower-margin service, were 46% of revenue against 38% in March, while two associates were on leave.",
    why: "Flat revenue with falling profit is a mix story more often than not. Saying which work grew, and why, turns a worry into a known, temporary cause.",
  },
  {
    line: "Staff costs — timing",
    company: "Marlowe Freight",
    weak: "Staff costs increased significantly in the month.",
    strong:
      "Staff costs rose £38,000 on last month to £221,000. Of that, £27,000 is the annual bonus, paid each June and not accrued monthly; without it, staff costs rose £11,000, or 6%, on two new drivers.",
    why: "Separating the timing item from the underlying change is most of the work. A reader told only “significantly” will ask both questions in the meeting.",
  },
  {
    line: "Overheads — a one-off",
    company: "Calder Software",
    weak: "Other operating expenses were higher than expected.",
    strong:
      "Other operating expenses were £74,000 against £52,000 a year ago. £18,000 is a one-off legal fee on the office lease renewal; the other £4,000 is the new CRM licence, which recurs.",
    why: "“Higher than expected” rests on an expectation nobody wrote down. Splitting the increase into what recurs and what does not tells the reader what next month looks like.",
  },
  {
    line: "EBITDA — classification",
    company: "Calder Software",
    weak: "EBITDA improved strongly this month.",
    strong:
      "EBITDA was reported at £63,000, up from £41,000, but £15,000 of that is the R&D tax credit, which belongs in other income. Moved there, EBITDA was £48,000, up £7,000 on the two contracts that went live in May.",
    why: "Before explaining a movement, check the line is what it says. A reclassification is a common cause of a surprising variance, and an easy one to miss.",
  },
  {
    line: "Stock — timing",
    company: "Harlow & Pike, a kitchenware wholesaler",
    weak: "Stock levels have increased.",
    strong:
      "Stock rose £96,000 to £410,000 at the end of May. The supplier shipped the Christmas range in one container instead of three; it sells through by October, so the cash it holds is timing, not slow-moving stock.",
    why: "A stock increase can be good buying or bad stock. One sentence saying which saves the reader asking for an ageing report.",
  },
  {
    line: "Cash — the bridge",
    company: "Fenwick Joinery",
    weak: "Cash decreased in the month.",
    strong:
      "Cash fell £58,000 to £121,000. The quarter’s VAT of £41,000 and the second £23,000 instalment on the new spindle moulder went out; trading itself added £6,000.",
    why: "Cash commentary is a bridge in words: what came in, what went out, and whether trading generated or consumed it.",
  },
];

const CAUSES: readonly { cause: string; test: string }[] = [
  {
    cause: "Price",
    test: "Did the same quantity sell, or cost, more or less than in the comparison period?",
  },
  {
    cause: "Volume",
    test: "Did more or fewer units, hours, jobs or customers go through at the same rate?",
  },
  {
    cause: "Mix",
    test: "Did the share of higher- and lower-margin work change, with the total roughly steady?",
  },
  {
    cause: "Timing",
    test: "Does the item belong to another month — a bonus, a quarterly bill, an early delivery?",
  },
  {
    cause: "A one-off",
    test: "Will it recur? Legal fees, a disposal, a settlement or a grant usually will not.",
  },
  {
    cause: "Classification",
    test: "Is the line holding what its name says, this month and in the comparison?",
  },
];

const MONTH: readonly string[] = [
  "Turnover was £1,060,000, up 4% on June last year. The two contract customers won in March added the volume; rates were unchanged.",
  "Gross margin fell 0.9 points to 22.8% as diesel averaged 6p a litre more than a year ago. The fuel surcharge in the new contracts starts in August.",
  "Staff costs of £221,000 include the £27,000 annual bonus, paid each June. Without it, they rose 6% on last month, on two new drivers.",
  "Nothing else moved by more than £10,000 or 10% against the comparison.",
];

const FAQS: readonly Faq[] = [
  {
    question: "What is commentary in management accounts?",
    answer:
      "The written part of the monthly pack: a short explanation of the movements that matter, set beside the profit and loss, balance sheet and cash figures. The tables say what happened; the commentary says why, and whether anything needs doing.",
  },
  {
    question: "Should the commentary explain every variance?",
    answer:
      "No. Agree a threshold with the reader — a movement over both a percentage and an amount — and explain only what crosses it. Then say, in one line, that nothing else did, so the reader knows the rest was looked at rather than skipped.",
  },
  {
    question: "What if the cause of a variance is not known yet?",
    answer:
      "Say so, and say when it will be. “Not yet explained; the purchase ledger is being reviewed and an answer will be in next month’s pack” is honest and useful. A plausible guess that turns out wrong costs more trust than the gap would have.",
  },
  {
    question: "Can AI write management accounts commentary?",
    answer: `It can draft the sentences, and ${PRODUCT_NAME} uses it to. It must not write the figures. Here the draft is written with blanks, the calculation engine fills each one from the computed figures, and a draft containing a number of its own is rejected before you see it. Where the data does not show a cause, the commentary says so rather than inventing one.`,
  },
];

export default function ManagementAccountsCommentaryExamples() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Guide"
        heading="Management accounts commentary examples: each weak line rewritten to name its cause"
        intro="Eight lines of profit and loss and balance sheet commentary as they are often written, and as they should be: the movement, what it is compared with, and the cause behind it. Then a whole month put together, and a test for finding the cause of any variance."
      />

      <Section title="Strong commentary names the movement, the comparison and the cause">
        <p>
          A weak line repeats the table or describes the movement with an adjective. A
          strong one does three things in a sentence or two: it gives the size of the
          movement, says what it is measured against, and names why it happened. If
          something is being done about it, that goes last. Everything below follows that
          shape.
        </p>
      </Section>

      <Section title="Eight P&L and balance sheet commentary examples, weak and strong">
        <ul className="flex flex-col gap-5">
          {PAIRS.map((pair) => (
            <li
              key={pair.weak}
              className="rounded-xl border border-neutral-200/80 bg-surface p-5"
            >
              <p className="text-[0.75rem] font-medium tracking-wide text-accent-700 uppercase">
                {pair.line}
              </p>
              <p className="mt-0.5 text-[0.8125rem] text-neutral-500">{pair.company}</p>
              <p className="mt-3 text-[0.9375rem] text-neutral-500">
                <span className="font-medium text-neutral-600">Weak: </span>
                {pair.weak}
              </p>
              <p className="mt-2 text-[0.9375rem] text-neutral-900">
                <span className="font-medium">Strong: </span>
                {pair.strong}
              </p>
              <p className="mt-2 text-[0.875rem] leading-relaxed text-neutral-600">
                {pair.why}
              </p>
            </li>
          ))}
        </ul>
        <FictionalNote>
          The companies and figures in these examples are invented for illustration.
        </FictionalNote>
      </Section>

      <Section title="Most variances come from price, volume, mix, timing, a one-off or a classification">
        <p>
          To explain variances in monthly financial statements, test each movement against
          these six causes before writing a word. Usually one or two account for nearly
          all of it, and naming them is the explanation.
        </p>
        <dl className="grid gap-3 sm:grid-cols-2">
          {CAUSES.map((c) => (
            <div
              key={c.cause}
              className="rounded-xl border border-neutral-200/80 bg-surface p-4"
            >
              <dt className="font-medium text-neutral-900">{c.cause}</dt>
              <dd className="mt-1 text-[0.9375rem] text-neutral-600">{c.test}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="A month of variance analysis commentary, put together, fits in four lines">
        <p>Marlowe Freight&rsquo;s June commentary, as it would sit in the pack:</p>
        <blockquote className="flex flex-col gap-2 rounded-xl border-l-4 border-accent-500 bg-surface px-5 py-4 text-[0.9375rem] text-neutral-800">
          {MONTH.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </blockquote>
        <FictionalNote>The company and its figures are invented.</FictionalNote>
        <p>
          It is ordered by what changes a decision, it separates the timing item from the
          trend, and its last line tells the reader the rest was checked. The same method
          in India&rsquo;s words, for an MIS report, is in the{" "}
          <Link href="/guides/mis-commentary" className="text-accent-700 hover:underline">
            guide to MIS commentary
          </Link>
          .
        </p>
      </Section>

      <MidCta />

      <Section title="Here the commentary is drafted around figures the engine has already computed">
        <p>
          {PRODUCT_NAME} drafts commentary on the movements in each month of your
          management accounts. The AI writes the words with blanks where the figures go,
          and the calculation engine fills every blank from the computed figures. A draft
          that contains a number of its own is rejected before you see it, and every
          figure in the commentary traces to the ledgers behind it. It is paid for in
          prepaid credits, with no subscription, and month two is a refresh rather than a
          rebuild.
        </p>
      </Section>

      <Section title="What people ask about writing management accounts commentary">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext
        paths={[
          "/guides/mis-commentary",
          "/management-accounts",
          "/ai-variance-analysis",
        ]}
      />
      <ClosingCta
        heading="Commentary where every figure comes from the books"
        body="Upload last month’s trial balance, and read commentary on what moved with every number filled in by the engine, never written by the AI."
      />
    </PublicShell>
  );
}
