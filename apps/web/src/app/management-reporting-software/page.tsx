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
      "No. One account is one login, with a single active session, and there are no team members or roles. To show someone the dashboard you can send a read-only link to a copy of it, frozen when the link is made, which expires and which you can withdraw at any time. The workbook it produces can be shared like any file.",
  },
  {
    question: "What happens to the files I upload?",
    answer:
      "They are encrypted when they arrive, under a key that belongs to that company alone, read only to produce the reports you pay for, and kept until you delete them. No member of our staff can open one, and every opening is recorded for you to see. They go when you delete them. The AI never receives a whole file; it sees redacted structure and samples for the specific step it performs.",
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

      <Section title="No connector, no seats, and no figure the AI wrote">
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

      <Section title="Financial reporting software for QuickBooks, Xero and Sage exports, with nothing connected">
        <p>
          QuickBooks, Xero and Sage each produce a trial balance and the aged receivables
          and payables reports in a few clicks, as Excel or CSV. That export is all{" "}
          {PRODUCT_NAME} needs. Columns are recognised by their headers, so the layout
          each system uses is read as it comes, and every account is mapped once to a
          report line and remembered for the months after.
        </p>
        <p>
          What to export from each, and how to set it up for a monthly pack:{" "}
          <Link
            href="/guides/management-accounts-from-xero"
            className="text-accent-700 hover:underline"
          >
            management accounts from Xero
          </Link>
          ,{" "}
          <Link
            href="/guides/management-accounts-from-quickbooks"
            className="text-accent-700 hover:underline"
          >
            from QuickBooks
          </Link>{" "}
          and{" "}
          <Link
            href="/guides/management-accounts-from-sage-50"
            className="text-accent-700 hover:underline"
          >
            from Sage 50
          </Link>
          .
        </p>
      </Section>

      <Section title="MIS reporting software and management accounts software are one product in two vocabularies">
        <p>
          Buyers in India look for MIS reporting software; buyers in the UK, Ireland,
          Australia and New Zealand look for management accounts software. They want the
          same thing — a monthly P&amp;L, balance sheet, KPIs, ageing and commentary from
          the books — and differ in the detail around it.
        </p>
        <p>
          An MIS is usually expected in lakhs and crores, on an April-to-March year, from
          a Tally export with dates written day first. Management accounts are expected in
          the local currency and the local words — turnover, debtors, creditors — on
          whatever year end the company has. Each company here records its own currency,
          number style and financial year, and every sheet of the workbook states its
          units.
        </p>
      </Section>

      <Section title="What is deliberately not here">
        <p>
          No live sync with your ledger, because a live sync is a standing permission and
          a standing risk. No forecasting or budgeting module, because a forecast is a
          judgement and this product computes. No team seats or client portals, because
          one login per account is the simplest security model there is; what can be
          shared is a read-only copy of one board, by a link that expires and that you can
          withdraw. Nothing paid for with your data, because a product that is free for
          ever is paid for by someone: you pay for what you run, from prepaid credits.
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

      <Section title="What buyers ask before choosing management reporting software">
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
