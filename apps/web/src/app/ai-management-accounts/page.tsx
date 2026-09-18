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

const PATH = "/ai-management-accounts";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "AI management accounts", "management accounts with AI", "AI for management accounts" — the
 * UK and Commonwealth angle on what /ai-mis-report says for India (ADR 0039). British
 * vocabulary; the same honest split between what AI does and what it never touches.
 */

const DOES: readonly { title: string; body: string }[] = [
  {
    title: "Recognises the raw data",
    body: "Which sheet is the trial balance, which is the aged debtors, which is noise. From the structure and a redacted sample, never the whole file.",
  },
  {
    title: "Maps the nominal codes",
    body: "Rules place most codes by their group; AI places the ones rules cannot, from redacted names. The mapping is remembered, so next month it is not asked again.",
  },
  {
    title: "Drafts the commentary",
    body: "Around figures the engine has already computed and checked. It writes the sentences; every number in them is inserted afterwards and a check rejects any draft that invents one.",
  },
];

const NEVER: readonly string[] = [
  "Compute a figure. Every number in the accounts, the dashboard and the commentary is deterministic arithmetic over the trial balance, with lineage to the nominal code.",
  "See a whole file. It receives redacted structure, capped samples and redacted names for the one step it performs.",
  "Run when nothing changed. A monthly refresh on an unchanged chart of accounts makes no AI calls at all.",
  "Decide what you pay. Each action has a standard price in credits, and a job that needs more than that stops and shows you a quote first.",
];

const FAQS: readonly Faq[] = [
  {
    question: "Can AI prepare management accounts?",
    answer:
      "It can do the parts that are recognition and language — telling a trial balance from a debtors report, placing an unfamiliar nominal code, drafting a paragraph about a variance. It should not do the arithmetic, and here it never does: every figure is computed by a deterministic engine from the trial balance and checked before the workbook is delivered.",
  },
  {
    question: "Is my client's data sent to an AI model?",
    answer:
      "Not as a file. The model receives the structure of a sheet, a small redacted sample, and redacted nominal names for the specific step it performs. Party names, account numbers and identifiers are replaced with tokens before anything leaves the server, and the raw files are encrypted under a key unique to that company and deleted on a schedule.",
  },
  {
    question: "Does it work with Xero, Sage and QuickBooks?",
    answer:
      "Yes — with any system that can give you a trial balance as Excel, CSV, PDF or text. There is no connector; you upload the raw file, so nothing has access to the client's ledger and nothing has to be installed.",
  },
  {
    question: "What does it cost?",
    answer:
      "Prepaid credits, bought in US dollars, with a standard price per action and a quote first if a job needs more. No subscription and no per-seat fee. A monthly refresh on an unchanged structure is the cheapest action, because it does the least.",
  },
];

export default function AiManagementAccountsPage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="AI, honestly"
        heading="Management accounts with AI — where the AI maps and writes, and never touches a number"
        intro="Most “AI accounting” is a feature inside your ledger: coding receipts, matching bank lines. This is the month-end pack itself, produced from the raw trial balance, with AI doing the recognising and the writing and a deterministic engine doing every figure."
      />
      <AlsoCalled path={PATH} />

      <Section title="What the AI does">
        <dl className="flex flex-col gap-3">
          {DOES.map((d) => (
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

      <Section title="What it never does">
        <ul className="flex list-disc flex-col gap-2 pl-5">
          {NEVER.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
        <p>
          That split is enforced in code, not in a policy: the server has no endpoint that
          forwards free text to a model, and a commentary draft that contains a figure of
          its own fails a check and is not shown. See{" "}
          <Link href="/security" className="text-accent-700 hover:underline">
            security and data handling
          </Link>{" "}
          for exactly where a file goes.
        </p>
      </Section>

      <Section title="What you get each month">
        <p>
          The management accounts pack: profit and loss for the month and year to date
          against last month and last year, a balance sheet summary, KPIs, aged debtors
          and creditors where the raw reports are loaded, written commentary, and a
          dashboard. In an Excel workbook with live formulas and lineage on every cell,
          printed to PDF in one click for the board pack.{" "}
          <Link href="/product" className="text-accent-700 hover:underline">
            See what the output looks like
          </Link>
          .
        </p>
      </Section>

      <MidCta />

      <Section title="Questions people ask">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext paths={["/automated-management-accounts", "/board-pack", "/security"]} />
      <ClosingCta
        heading="Try it on a client month you have already closed"
        body={`Create an account, add the company, and drop in its raw trial balance. ${PRODUCT_NAME} produces the pack, and you check every figure against its lineage.`}
      />
    </PublicShell>
  );
}
