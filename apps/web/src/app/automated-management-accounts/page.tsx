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

const PATH = "/automated-management-accounts";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "Automated management accounts", "management accounts software", "management accounts
 * from trial balance" — the UK, Irish, Australian, New Zealand and South African wording of
 * what India calls an MIS. Written in that vocabulary throughout: aged debtors, VAT, "pack".
 */

const PACK: readonly { title: string; body: string }[] = [
  {
    title: "Profit and loss",
    body: "Revenue to profit after tax by month across the financial year, with margins, against the previous month and the same month last year.",
  },
  {
    title: "Balance sheet summary",
    body: "Receivables, inventory, cash, payables and working capital at the month end, against the prior month and last year.",
  },
  {
    title: "KPIs",
    body: "Current and quick ratios, debtor, creditor and stock days, and the cash conversion cycle.",
  },
  {
    title: "Aged debtors and creditors",
    body: "Outstanding invoices by age from invoice date, when you load the outstanding invoices report alongside the trial balance.",
  },
  {
    title: "Commentary",
    body: "A written account of the month's material movements, with every figure inserted from the computed report.",
  },
  {
    title: "Dashboard",
    body: "The same figures as charts, for the conversation with a director who will not open a spreadsheet.",
  },
];

const FAQS: readonly Faq[] = [
  {
    question:
      "What is the difference between management accounts and statutory accounts?",
    answer:
      "Statutory accounts are prepared once a year in a prescribed format for filing and for shareholders. Management accounts are prepared monthly or quarterly, in whatever format helps the business make decisions, and are not filed anywhere. They can carry detail — KPIs, aged debtors, commentary — that statutory accounts never would.",
  },
  {
    question: "Which accounting software does it work with?",
    answer:
      "Any system that can give you a trial balance, as Excel, CSV, PDF or plain text. It works from raw data files rather than a live connection, so there is nothing to install and no access to grant to your accounting system.",
  },
  {
    question: "Can I set my financial year and date format?",
    answer:
      "Yes. Each company records its reporting currency, the month its financial year starts and how its dates are written, and every report follows them. Dates in a file are checked against the company's setting rather than guessed.",
  },
  {
    question: "How is it priced?",
    answer:
      "Prepaid credits, bought in US dollars. Each action has a standard price, and a job that needs more shows you a quote before anything runs. There is no subscription and no per-seat fee.",
  },
];

export default function AutomatedManagementAccountsPage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Management accounts"
        heading="Automated management accounts from your trial balance"
        intro="A monthly management accounts pack is the same work every month: pull the raw trial balance, map it, roll the workbook forward, write the commentary. Map it once, and the rest is produced for you — with every figure traceable to the ledger it came from."
      />
      <AlsoCalled path={PATH} />

      <Section title="What is in the pack">
        <div className="grid gap-4 sm:grid-cols-2">
          {PACK.map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-neutral-200/80 bg-surface p-5"
            >
              <h3 className="text-[0.9375rem] font-semibold text-neutral-900">
                {item.title}
              </h3>
              <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-neutral-600">
                {item.body}
              </p>
            </div>
          ))}
        </div>
        <p>
          Delivered as an Excel workbook with live formulas, so the figures can be checked
          and the pack extended in the tool your reviewers already use.
        </p>
      </Section>

      <Section title="Why automate it this way">
        <p>
          <strong className="font-medium text-neutral-900">
            Your files are encrypted and deleted on schedule.
          </strong>{" "}
          Each company&rsquo;s files are encrypted under its own key and deleted
          automatically. The AI receives redacted samples and ledger names, never the file
          and never your customers&rsquo; or suppliers&rsquo; names.
        </p>
        <p>
          <strong className="font-medium text-neutral-900">
            The numbers are computed, not generated.
          </strong>{" "}
          AI helps recognise files, propose mappings and draft commentary. Every figure
          comes from a deterministic engine.
        </p>
        <p>
          <strong className="font-medium text-neutral-900">
            Month two costs less than month one.
          </strong>{" "}
          A refresh on an unchanged chart of accounts reuses the confirmed mapping and
          makes no AI calls.
        </p>
      </Section>

      <MidCta />

      <Section title="Questions">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext
        paths={[
          "/management-accounts",
          "/guides/debtors-ageing-report",
          "/for-accountants",
        ]}
      />
      <ClosingCta
        heading="Your next pack, without the rebuild"
        body={`${PRODUCT_NAME} produces monthly management accounts from the raw trial balance. Pay per action from prepaid credits.`}
      />
    </PublicShell>
  );
}
