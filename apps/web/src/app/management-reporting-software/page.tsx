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

const PATH = "/management-reporting-software";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "Management reporting software", "management accounts software", "MIS software", "financial
 * reporting software for small business" — the buyer's comparison query in every market. The
 * page says what is different and what is deliberately absent, in plain terms.
 */

const DIFFERENCES: readonly { title: string; body: string }[] = [
  {
    title: "No connector, no integration project",
    body: "Most management reporting software starts with connecting your accounting system and mapping its chart of accounts in a setup wizard. This starts with raw data: the trial balance you already have. Nothing to install, no access to grant, and it works with any system that can give you one.",
  },
  {
    title: "The output is a workbook you own",
    body: "Not a dashboard behind a login. An Excel file with live formulas and lineage on every cell, which opens anywhere, prints anywhere, and stays yours if you stop paying.",
  },
  {
    title: "Every figure is computed, never generated",
    body: "AI maps ledgers and drafts commentary. It does not write numbers. Every figure in the report, the dashboard and the commentary comes from a deterministic engine and traces back to the account it came from.",
  },
  {
    title: "Checked before it is delivered",
    body: "The trial balance must net to zero, subtotals must tie, this month must continue from last. A report that fails a check says so; one that fails badly is not delivered.",
  },
  {
    title: "Paid per report, not per seat",
    body: "Prepaid credits with a standard price per action. No subscription, no per-user licence, no annual contract. A company that reports monthly pays twelve times a year.",
  },
  {
    title: "Written in your market's words",
    body: "MIS report, management accounts, monthly financials — the same report, in your currency, number style and financial year, with the units stated on every sheet.",
  },
];

const FAQS: readonly Faq[] = [
  {
    question: "Which accounting software does it work with?",
    answer:
      "Any that can give you a raw trial balance: Tally, Xero, QuickBooks, Sage, Zoho Books, NetSuite, Busy, MYOB and the rest. Excel, CSV, PDF and plain-text files are all read, and columns are recognised by their headers rather than their positions, so a new file layout does not break anything.",
  },
  {
    question: "Is it management accounts software or MIS software?",
    answer:
      "Both, because they are the same thing. Management accounts (UK, Ireland, Australia), an MIS report (India, South Asia, the Gulf) and monthly financial reporting (US) are one monthly document under different names, and the software produces it in whichever vocabulary, currency and number style the company uses.",
  },
  {
    question: "Can several people in my firm use one account?",
    answer:
      "No. One account is one login, with a single active session. There are no team members, roles or share links. The workbook it produces can be shared like any file.",
  },
  {
    question: "What happens to the files I upload?",
    answer:
      "They are encrypted when they arrive, under a key that belongs to that company alone, read only to produce the reports you pay for, and deleted automatically on a schedule — or sooner when you delete them. The AI never receives a whole file; it sees redacted structure and samples for the specific step it performs.",
  },
];

export default function ManagementReportingSoftwarePage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Software"
        heading="Management reporting software that starts from raw data, not a connector"
        intro="Most management reporting tools want to connect to your accounting system, learn its chart of accounts in a setup project, and show you a dashboard. This one takes the raw trial balance you already have and gives you back a checked Excel workbook, a dashboard and written commentary — paid per report."
      />
      <AlsoCalled path={PATH} />

      <Section title="What is different">
        <dl className="grid gap-4 sm:grid-cols-2">
          {DIFFERENCES.map((d) => (
            <div
              key={d.title}
              className="rounded-xl border border-neutral-200/80 bg-surface p-4"
            >
              <dt className="font-medium text-neutral-900">{d.title}</dt>
              <dd className="mt-1 text-[0.9375rem] text-neutral-600">{d.body}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="What is deliberately not here">
        <p>
          No live sync with your ledger, because a live sync is a standing permission and
          a standing risk. No forecasting or budgeting module, because a forecast is a
          judgement and this product computes. No team seats, client portals or share
          links, because one login per account is the simplest security model there is. No
          free tier, because a free tier is paid for by someone, and here it would be paid
          for with your data.
        </p>
        <p>
          What is here is the report:{" "}
          <Link href="/product" className="text-accent-700 hover:underline">
            see what you get each month
          </Link>
          , and{" "}
          <Link href="/security" className="text-accent-700 hover:underline">
            exactly where your files go
          </Link>
          .
        </p>
      </Section>

      <MidCta />

      <Section title="Questions people ask">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext paths={["/product", "/how-it-works", "/pricing"]} />
      <ClosingCta
        heading="Try it on a month you have already closed"
        body={`Create an account, add a company, and drop in a trial balance. ${PRODUCT_NAME} builds the report, and you decide whether to run the next month.`}
      />
    </PublicShell>
  );
}
