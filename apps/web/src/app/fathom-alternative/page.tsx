import Link from "next/link";
import type { Metadata } from "next";

import {
  ClosingCta,
  Faqs,
  MarketingHeader,
  MidCta,
  ReadNext,
  Section,
  WideSection,
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

const PATH = "/fathom-alternative";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "Fathom alternative", "Fathom reporting alternatives", "Fathom reporting pricing", "Fathom vs …"
 * (docs/plans/seo-keywords.md, row 3 of the pages worth building).
 *
 * Every statement about Fathom is taken from Fathom's own website, read on 2026-10-05, and the
 * pages are listed in SOURCES at the foot of the page. Its pricing is described as a model —
 * monthly, by number of companies, in plans — and never as a figure, because its prices change
 * and a stale one on our page would be a claim we cannot stand behind. The page says plainly
 * what Fathom does that this product does not, and who should choose it: a comparison that only
 * praises its author is neither credible nor fair. Re-read the sources before changing a claim.
 */

const CHECKED = "5 October 2026";

/** Topic, Fathom (from its own pages, as of October 2026), this product. */
const ROWS: readonly (readonly [string, string, string])[] = [
  [
    "How the numbers get in",
    "Direct integrations with Xero, QuickBooks Online and Desktop, MYOB, Sage Accounting (UK) and FreeAgent, with an automated daily sync from cloud accounting systems. Other systems can be imported through Excel.",
    "Raw exports you upload: the trial balance, ledgers and registers from Tally, Xero, QuickBooks, Sage or anything else, as Excel, CSV or PDF. It never connects to your accounting system.",
  ],
  [
    "How it is priced",
    "A monthly subscription with no minimum term, priced by the number of companies you connect. A Pro plan, a Portfolio plan for overseeing a firm's whole client base, and quoted Enterprise pricing for larger groups.",
    "Prepaid credits with no subscription. Each action has a standard price, credits never expire, and each company you keep carries a monthly memory fee paid from the same credits.",
  ],
  [
    "Forecasting and budgets",
    "Three-way cash flow forecasting, budgets, scenarios and what-ifs.",
    "Not offered.",
  ],
  [
    "Consolidation",
    "Multi-currency consolidations with eliminations, and group benchmarking to compare and rank companies.",
    "Not offered. Each company is reported on its own.",
  ],
  [
    "Reports",
    "Custom management reports for print or web, with scheduled delivery, and KPIs measured against budget, target and prior periods.",
    "A checked Excel workbook — profit and loss with year to date, a balance sheet summary, key ratios, receivables and payables ageing, and a payroll summary when payroll data is present — and a dashboard you build by chatting and present live.",
  ],
  [
    "AI",
    "Commentary Writer, AI commentary inside the reports.",
    "Written variance commentary and suggestions on where to act. The AI maps ledgers and writes words; every figure is computed by the engine.",
  ],
  [
    "Users",
    "Unlimited users on its plans.",
    "One login per account, with one active session.",
  ],
];

const CHOOSE_FATHOM: readonly string[] = [
  "Your clients are on Xero, QuickBooks, MYOB, Sage or FreeAgent and you want their figures to sync every day without anyone exporting a file.",
  "You need cash flow statements, three-way forecasts, budgets or scenarios. Fathom projects the profit and loss, balance sheet and cash flow together; this product has no forecasts, and its workbook has no cash flow statement.",
  "You report on groups: consolidations with eliminations across currencies, or benchmarking franchisees and clients against each other.",
  "Several people in your firm need their own logins to the same clients.",
  "You want a predictable monthly subscription and reports whose delivery is scheduled for you.",
];

const CHOOSE_THIS: readonly string[] = [
  "Your clients send you exports rather than access — a Tally trial balance, a desktop system, a spreadsheet — and you would rather not hold a standing connection to anyone's ledger.",
  "You would rather pay for what you run from prepaid credits than carry a subscription for every company every month. Credits never expire.",
  "You want the output as an Excel workbook you own, checked before it is delivered, with every figure traceable to its ledgers.",
  "You want an AI that writes the commentary but is never allowed to write a figure.",
  "You report monthly, and want month two to be a refresh on the mapping you already confirmed rather than a fresh setup.",
];

const FAQS: readonly Faq[] = [
  {
    question: `Is ${PRODUCT_NAME} a Fathom alternative for Xero and QuickBooks users?`,
    answer:
      "For monthly management reports, yes, but it works differently. Fathom connects to Xero and QuickBooks and syncs. This takes the raw trial balance and ledgers you export from them, maps every ledger to a report head once, and builds a checked workbook, a dashboard and commentary from the files. If a live sync matters more to you than not granting access, Fathom is the better fit.",
  },
  {
    question: "How does Fathom's pricing compare?",
    answer:
      "As of October 2026, Fathom is a monthly subscription with no minimum term, priced by the number of companies you connect, in Pro, Portfolio and Enterprise plans; its current prices are on its own pricing page. This product has no subscription: you buy credit packs, each action has a standard price, credits never expire, and each company you keep carries a monthly memory fee. Which costs less depends on how many companies you report on and how often.",
  },
  {
    question: `Can ${PRODUCT_NAME} forecast, budget or consolidate like Fathom?`,
    answer:
      "No. There is no forecasting, budgeting, scenario planning or consolidation of several entities. If you need any of them, Fathom offers all three.",
  },
  {
    question: "Fathom also says every number is traceable. What is different here?",
    answer:
      "The rule about who writes the numbers. Here the AI recognises files, proposes ledger mappings and drafts commentary with a blank wherever a figure belongs. The engine computes every figure and fills the blanks, and a draft with a number of its own is rejected. Click any figure and it shows the ledgers behind it.",
  },
  {
    question: "Can I move a client from Fathom to it?",
    answer:
      "Export the client's trial balance and ledgers from their accounting system, add the company and drop in the files. Every ledger is mapped to a report head once; from then on each month is a refresh on that mapping.",
  },
  {
    question: "Who can open my clients' files?",
    answer:
      "No one on our side. Files are encrypted under a key that belongs to that company alone, every opening is recorded where you can see it, and deleting the company destroys its key.",
  },
];

const SOURCES: readonly { label: string; href: string }[] = [
  { label: "Fathom home page", href: "https://www.fathomhq.com/" },
  { label: "Fathom pricing", href: "https://www.fathomhq.com/pricing" },
  { label: "Fathom integrations", href: "https://www.fathomhq.com/integrations" },
];

export default function FathomAlternativePage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Fathom alternative"
        heading="A Fathom alternative for management reports paid from prepaid credits, with no subscription"
        intro="Fathom is a well-made reporting, forecasting and consolidation tool sold as a monthly subscription by the number of companies you connect. This is a narrower product: it takes the raw exports you already have, builds a checked Excel workbook, a dashboard and written commentary, and charges per report from credits that never expire."
      />

      <Section title="Fathom does more than this product, and for some firms that settles it">
        <p>
          Fathom connects directly to Xero, QuickBooks, MYOB, Sage and FreeAgent and syncs
          from cloud systems every day. It forecasts, budgets and runs scenarios, it
          consolidates groups across currencies, it benchmarks companies against each
          other, and its Commentary Writer adds AI commentary to its reports. None of that
          is here, and saying so is the honest start to any Fathom comparison.
        </p>
        <p>
          What this product does instead is one job: the monthly management report, built
          from files rather than a connection, paid for when you run it.
        </p>
      </Section>

      <WideSection
        title="Fathom and this product side by side, as of October 2026"
        intro={`Everything in the Fathom column comes from Fathom's own website, read on ${CHECKED}. Its prices change, so they are not repeated here; the model is.`}
      >
        <div className="mx-auto max-w-[900px]">
          <div className="overflow-x-auto rounded-xl border border-neutral-200/80 bg-surface">
            <table className="w-full min-w-[620px] border-collapse text-[0.9375rem]">
              <thead>
                <tr className="border-b border-neutral-200/80 text-[0.8125rem] text-neutral-500">
                  <th scope="col" className="w-[22%] px-5 py-2.5 text-left font-medium">
                    <span className="sr-only">Topic</span>
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-left font-medium">
                    Fathom
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-left font-medium">
                    {PRODUCT_NAME}
                  </th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map(([topic, theirs, ours]) => (
                  <tr
                    key={topic}
                    className="border-b border-neutral-100 align-top last:border-0"
                  >
                    <th
                      scope="row"
                      className="px-5 py-3 text-left font-medium text-neutral-900"
                    >
                      {topic}
                    </th>
                    <td className="px-5 py-3 leading-relaxed text-neutral-600">
                      {theirs}
                    </td>
                    <td className="px-5 py-3 leading-relaxed text-neutral-700">{ours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[0.875rem] text-neutral-500">
            What each action costs here is on the{" "}
            <Link href="/pricing" className="text-accent-700 hover:underline">
              credit packs page
            </Link>
            .
          </p>
        </div>
      </WideSection>

      <Section title="Choose Fathom if you need live feeds, forecasting or consolidation">
        <ul className="flex list-disc flex-col gap-2.5 pl-5">
          {CHOOSE_FATHOM.map((line) => (
            <li key={line} className="leading-relaxed">
              {line}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Choose this product if your clients send exports and you would rather not subscribe">
        <ul className="flex list-disc flex-col gap-2.5 pl-5">
          {CHOOSE_THIS.map((line) => (
            <li key={line} className="leading-relaxed">
              {line}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="The AI writes the commentary and is never allowed to write a figure">
        <p>
          The AI recognises what you loaded, proposes a report head for each ledger the
          rules cannot place, and drafts the commentary and the suggestions on where to
          act. Where a figure belongs it leaves a blank. The engine computes every figure,
          fills the blanks, and rejects any draft that contains a number of its own — so a
          figure in the report can be traced to the ledgers it came from.
        </p>
        <p>
          The mapping is kept. Month two is a refresh on the mapping you confirmed, not a
          new setup, and only a ledger that did not exist last month needs a decision. No
          one on our side can open your files, and every opening is recorded where you can
          see it.{" "}
          <Link href="/security" className="text-accent-700 hover:underline">
            Exactly where your files go
          </Link>
          .
        </p>
      </Section>

      <MidCta />

      <Section title="What people ask when comparing Fathom with this product">
        <Faqs faqs={FAQS} />
      </Section>

      <Section
        title={`Every claim about Fathom here was read on its own website on ${CHECKED}`}
      >
        <p>
          Products change. If something about Fathom on this page is out of date, its own
          pages are the authority:
        </p>
        <ul className="flex list-disc flex-col gap-1.5 pl-5">
          {SOURCES.map((s) => (
            <li key={s.href}>
              <a
                href={s.href}
                rel="nofollow noopener noreferrer"
                className="text-accent-700 hover:underline"
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
        <p className="text-[0.875rem] text-neutral-500">
          Fathom is a trademark of its owner. This page is an independent comparison and
          is not endorsed by Fathom.
        </p>
      </Section>

      <ReadNext
        paths={["/management-reporting-software", "/for-accountants", "/pricing"]}
      />
      <ClosingCta
        heading="Try it on a month you have already closed"
        body={`Create an account, add a company and drop in last month's trial balance. ${PRODUCT_NAME} builds the report, and you decide whether to run the next month.`}
      />
    </PublicShell>
  );
}
