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

const PATH = "/syft-alternative";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "Syft Analytics alternative", "Syft vs Fathom", "Syft Analytics vs Power BI"
 * (docs/plans/seo-keywords.md, row 10 of the pages worth building). Syft is strongest in
 * Australia, New Zealand, South Africa and the UK.
 *
 * Every statement about Syft is taken from Syft's own website and knowledge centre, read on
 * 2026-10-05, and the pages are listed in SOURCES at the foot of the page. Its pricing is
 * described as a model — monthly, in tiers, a plan per entity — and never as a figure, because
 * its prices change. Syft can also take a trial balance from a spreadsheet, so the page does
 * not pretend that raw exports are ours alone: the difference is that here they are the only
 * way in, by design. Re-read the sources before changing a claim.
 */

const CHECKED = "5 October 2026";

/** Topic, Syft (from its own pages, as of October 2026), this product. */
const ROWS: readonly (readonly [string, string, string])[] = [
  [
    "How the numbers get in",
    "Direct integrations with Xero, QuickBooks Online and Desktop, Sage, MYOB, FreshBooks and FreeAgent, plus e-commerce, payments, payroll and bank feeds. A trial balance or a transaction list can also be uploaded from Excel or Google Sheets through its Spreadsheet Link.",
    "Raw exports you upload: the trial balance, ledgers and registers from Tally, Xero, QuickBooks, Sage or anything else, as Excel, CSV or PDF. It never connects to your accounting system.",
  ],
  [
    "How it is priced",
    "A monthly subscription in Standard, Plus and Advanced tiers. Each entity sits on a plan, plans can be mixed across entities, and more than ten entities is quoted. A free Basic plan covers dashboards and graphs, and paid plans start with a 14-day trial.",
    "Prepaid credits with no subscription. Each action has a standard price, credits never expire, and each company you keep carries a monthly memory fee paid from the same credits.",
  ],
  [
    "Forecasting and budgets",
    "Cash flow forecasting, budgets, profit and loss forecasting and driver-based modelling.",
    "Not offered.",
  ],
  [
    "Consolidation",
    "Multi-entity consolidations with eliminations and currency management, at no extra charge.",
    "Not offered. Each company is reported on its own.",
  ],
  [
    "Reports and dashboards",
    "Interactive dashboards, financial reports and IFRS and GAAP financial statements, exported to PDF, Excel or Word, and live dashboards shared with anyone.",
    "A checked Excel workbook — profit and loss with year to date, a balance sheet summary, key ratios, receivables and payables ageing, and a payroll summary when payroll data is present — and a dashboard you build by chatting and present live, or send as a read-only copy by a link that expires and can be withdrawn.",
  ],
  [
    "AI",
    "Syft Assist, AI insights on dashboard cards, automated commentary and machine-learning anomaly detection across accounts and transactions.",
    "Written variance commentary and suggestions on where to act. The AI maps ledgers and writes words; every figure is computed by the engine.",
  ],
  [
    "Users",
    "Unlimited team and external users.",
    "One login per account, with one active session.",
  ],
];

const CHOOSE_SYFT: readonly string[] = [
  "You want live connections to Xero, QuickBooks, Sage or MYOB, and to put e-commerce, payroll or bank data beside the accounts.",
  "You need cash flow forecasts, budgets or consolidations of several entities across currencies. This product has none of them: its cash flow statement reports the months that have happened, and forecasts nothing.",
  "You want a free plan for dashboards and graphs, or to share a live dashboard with a client by link.",
  "Your team and your clients need their own logins.",
  "You work in Xero: the analytics inside Xero are powered by Syft.",
];

const CHOOSE_THIS: readonly string[] = [
  "Your clients send you exports rather than access — a Tally trial balance, a Sage 50 file, a spreadsheet — and you want exports to be the only way in, with no standing connection to anyone's ledger.",
  "You would rather pay for what you run from prepaid credits than carry a monthly plan for every entity. Credits never expire.",
  "You want the output as an Excel workbook you own, checked before it is delivered, with every figure traceable to its ledgers.",
  "You want an AI that writes the commentary but is never allowed to write a figure.",
  "You report monthly, and want month two to be a refresh on the mapping you already confirmed rather than a fresh setup.",
];

const FAQS: readonly Faq[] = [
  {
    question: "What is a good Syft Analytics alternative for monthly management reports?",
    answer: `It depends on what you use Syft for. If it is forecasting, consolidation or live dashboards shared with clients, Fathom is the closer like-for-like comparison. If it is the monthly management report itself — profit and loss, balance sheet summary, key ratios, ageing and commentary — ${PRODUCT_NAME} builds it from the raw exports and charges per report from prepaid credits, with no subscription.`,
  },
  {
    question: "Does Syft work from a trial balance too?",
    answer:
      "Yes. Syft's Spreadsheet Link can create an entity from a trial balance or a transaction list in Excel or Google Sheets, alongside its direct integrations. The difference here is that an export is the only way in: nothing connects to your accounting system, so nothing holds standing access to it.",
  },
  {
    question: "How does Syft's pricing compare?",
    answer:
      "As of October 2026, Syft is a monthly subscription in Standard, Plus and Advanced tiers with a plan for each entity, a free Basic plan for dashboards and graphs, and quoted pricing beyond ten entities; its current prices are on its own pricing page. This product has no subscription: you buy credit packs, each action has a standard price, credits never expire, and each company you keep carries a monthly memory fee.",
  },
  {
    question: `Syft vs Fathom vs ${PRODUCT_NAME}: which should I choose?`,
    answer:
      "Syft and Fathom are both monthly subscriptions that connect to your accounting system and add forecasting and consolidation to reporting. Syft also lists e-commerce, payroll and bank-feed data and a free dashboard plan; Fathom lists three-way cash flow forecasting and benchmarking companies against each other. Choose this product if you want the monthly report from exports, paid per report, with an AI that never writes a figure.",
  },
  {
    question: "Is it a Syft Analytics alternative to Power BI-style dashboards?",
    answer:
      "Partly. The dashboard here is built by asking for what you want in a chat box — a box for gross margin by month, a breakdown of overdue debtors — and is presented live from the product. It shows the accounts you loaded, not data from other systems, and every figure on it opens to the ledgers behind it.",
  },
  {
    question: "Who can open my clients' files?",
    answer:
      "No one on our side. Files are encrypted under a key that belongs to that company alone, every opening is recorded where you can see it, and deleting the company destroys its key.",
  },
];

const SOURCES: readonly { label: string; href: string }[] = [
  { label: "Syft home page", href: "https://www.syftanalytics.com/" },
  { label: "Syft plans and pricing", href: "https://www.syftanalytics.com/pricing-page" },
  { label: "Syft integrations", href: "https://www.syftanalytics.com/integrations" },
  {
    label: "Syft for accountants",
    href: "https://www.syftanalytics.com/accountant-solution",
  },
  {
    label: "Syft knowledge centre: how to upgrade your Syft plan",
    href: "https://help.syftanalytics.com/en/articles/12413566-how-to-upgrade-your-syft-plan",
  },
  {
    label: "Syft knowledge centre: what's new on Xero Analytics",
    href: "https://help.syftanalytics.com/en/articles/11205090-what-s-new-on-xero-analytics",
  },
  {
    label: "Fathom home page, for the answer comparing Syft with Fathom",
    href: "https://www.fathomhq.com/",
  },
];

export default function SyftAlternativePage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Syft Analytics alternative"
        heading="A Syft Analytics alternative that builds the monthly report from raw exports, with no subscription"
        intro="Syft is a broad reporting, analytics, forecasting and consolidation platform sold as a monthly plan for each entity. This is a narrower product: it takes the trial balance and ledgers you export, builds a checked Excel workbook, a dashboard and written commentary, and charges per report from prepaid credits that never expire."
      />

      <Section title="Syft does more than this product, and for some firms that settles it">
        <p>
          Syft connects directly to Xero, QuickBooks, Sage, MYOB and more, and brings in
          e-commerce, payments, payroll and bank feeds beside the accounts. It forecasts,
          budgets and models drivers, consolidates entities across currencies with
          eliminations, flags anomalies across accounts and transactions, and shares live
          dashboards with anyone. None of that is here, and saying so is the honest start
          to any Syft comparison.
        </p>
        <p>
          What this product does instead is one job: the monthly management report, built
          from files rather than a connection, paid for when you run it.
        </p>
      </Section>

      <WideSection
        title="Syft and this product side by side, as of October 2026"
        intro={`Everything in the Syft column comes from Syft's own website and knowledge centre, read on ${CHECKED}. Its prices change, so they are not repeated here; the model is.`}
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
                    Syft Analytics
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

      <Section title="Choose Syft if you need live feeds, forecasting or consolidation">
        <ul className="flex list-disc flex-col gap-2.5 pl-5">
          {CHOOSE_SYFT.map((line) => (
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

      <Section title="What people ask when comparing Syft with this product">
        <Faqs faqs={FAQS} />
      </Section>

      <Section
        title={`Every claim about Syft here was read on its own website on ${CHECKED}`}
      >
        <p>
          Products change. If something about Syft on this page is out of date, its own
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
          Syft and Syft Analytics are trademarks of their owner. This page is an
          independent comparison and is not endorsed by Syft.
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
