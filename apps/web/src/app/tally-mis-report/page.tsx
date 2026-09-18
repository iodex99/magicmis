import type { Metadata } from "next";

import {
  AlsoCalled,
  ClosingCta,
  Faqs,
  FictionalNote,
  MarketingHeader,
  MidCta,
  ReadNext,
  Section,
  Steps,
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

const PATH = "/tally-mis-report";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "MIS report from Tally" — the query closest to what this product actually does.
 *
 * Deliberately does **not** print TallyPrime menu paths. They could not be verified against
 * Tally's own documentation (R-07), and an invented menu path on a public page is worse
 * than no page: the reader follows it, it is wrong, and every other claim here loses its
 * credibility at the same moment. The reports are named instead, which is stable.
 */

const EXPORTS: readonly {
  report: string;
  why: string;
  required: boolean;
}[] = [
  {
    report: "Trial Balance",
    why: "The ledger balances every MIS is built from. One per month you want to report.",
    required: true,
  },
  {
    report: "Profit & Loss A/c",
    why: "Checks the MIS income statement back against the books.",
    required: false,
  },
  {
    report: "Balance Sheet",
    why: "Checks assets and liabilities at the month end.",
    required: false,
  },
  {
    report: "Bills Receivable",
    why: "Outstanding customer bills with due dates — the debtors ageing section.",
    required: false,
  },
  {
    report: "Bills Payable",
    why: "Outstanding supplier bills with due dates — the creditors ageing section.",
    required: false,
  },
  {
    report: "Day Book or Ledger Vouchers",
    why: "Voucher-level detail, used to explain a movement rather than just show it.",
    required: false,
  },
  {
    report: "Sales and Purchase Registers",
    why: "Invoice-level revenue and input GST, where the MIS needs that detail.",
    required: false,
  },
  {
    report: "Stock Summary",
    why: "Closing quantities and values, for inventory days and stock movement.",
    required: false,
  },
];

const SETTINGS: readonly {
  title: string;
  body: string;
  icon: "table" | "info" | "check";
}[] = [
  {
    title: "Export as Excel, never PDF",
    body: "A PDF export turns every figure into text on a page. The numbers have to be re-keyed or scraped, and both introduce errors that are invisible until someone reconciles.",
    icon: "table",
  },
  {
    title: "Keep the ledger detail",
    body: "A trial balance condensed to groups loses the ledger names, and the ledger names are what the mapping is built from. Export with ledgers shown under each group.",
    icon: "info",
  },
  {
    title: "One export per month, not a range",
    body: "A single export covering a year cannot be split back into months reliably. Export each month separately and the comparatives build themselves.",
    icon: "check",
  },
];

const STEPS = [
  {
    icon: "upload" as const,
    title: "Export the reports and upload them",
    body: "Drop the raw files in, in any format. They are encrypted as they arrive, and before you pay for anything the screen shows only file names, sizes, sheet counts and row counts.",
  },
  {
    icon: "table" as const,
    title: "The ledger mapping is done for you",
    body: "Each ledger is matched to a canonical MIS head: Tally's group structure does most of the work and AI handles what is left. The mapping is kept, so next month it is reused.",
  },
  {
    icon: "check-circle" as const,
    title: "Take the workbook",
    body: "A validated Excel workbook with live formulas, a dashboard and written commentary. Every figure traces back to the ledger and voucher it came from.",
  },
  {
    icon: "refresh" as const,
    title: "Next month, refresh",
    body: "Load the new trial balance. If the structure has not changed, the refresh reuses the mapping and makes no AI calls at all — which is why a monthly refresh costs a fraction of the first setup.",
  },
];

const FAQS: readonly Faq[] = [
  {
    question: "Can Tally produce an MIS report by itself?",
    answer:
      "Tally produces the underlying reports — trial balance, P&L, balance sheet, registers and outstandings — but not a consolidated management report with comparatives, ratios, ageing and commentary in one workbook. That assembly is what is normally done by hand in Excel each month.",
  },
  {
    question: "Do I need to connect anything to my Tally installation?",
    answer:
      "No. There is no connector, no ODBC link and nothing to install beside Tally. You export the reports you would export anyway and upload the files; nothing connects to your Tally installation.",
  },
  {
    question: "Does my accounting data leave my computer?",
    answer:
      "The raw files are uploaded, encrypted under a key unique to that company, and deleted automatically. The AI model receives only redacted samples and ledger names, never a whole file and never your parties' names.",
  },
  {
    question: "What if ledger names change between months?",
    answer:
      "New and renamed ledgers are flagged for you to place, and the rest of the mapping is reused. Only the changed part needs attention — the structure being unchanged is the normal case, and that case makes no AI calls.",
  },
  {
    question: "Does it work with Tally.ERP 9 as well as TallyPrime?",
    answer:
      "Yes. Parsing is driven by the column headers in the export rather than by fixed positions, so both versions' files are read the same way and a changed column order does not break it.",
  },
];

export default function TallyMisReportPage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Guide"
        heading="MIS report from Tally: which raw reports to take, and what to do with them"
        intro="Tally holds everything a monthly MIS needs, in reports it already produces. What it does not do is assemble them into one management report with comparatives, ratios, ageing and commentary. This is how to bridge that gap — by hand, or without."
      />
      <AlsoCalled path={PATH} />

      <WideSection
        title="The raw reports worth taking"
        intro="Only the first is required. Each of the others adds a section to the report rather than being needed to produce one."
      >
        <div className="mx-auto max-w-[860px] overflow-x-auto rounded-xl border border-neutral-200/80 bg-surface">
          <table className="w-full min-w-[520px] border-collapse text-[0.9375rem]">
            <thead>
              <tr className="border-b border-neutral-200/80 text-[0.8125rem] text-neutral-500">
                <th scope="col" className="px-5 py-3 text-left font-medium">
                  Tally report
                </th>
                <th scope="col" className="px-5 py-3 text-left font-medium">
                  What it gives the MIS
                </th>
              </tr>
            </thead>
            <tbody>
              {EXPORTS.map((row) => (
                <tr
                  key={row.report}
                  className="border-b border-neutral-100 last:border-0"
                >
                  <th
                    scope="row"
                    className="px-5 py-3 text-left align-top font-medium text-neutral-900"
                  >
                    {row.report}
                    {row.required ? (
                      <span className="mt-1 block text-[0.75rem] font-normal text-accent-700">
                        Required
                      </span>
                    ) : null}
                  </th>
                  <td className="px-5 py-3 align-top text-neutral-600">{row.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mx-auto mt-4 max-w-[860px] text-[0.8125rem] text-neutral-500">
          Menu paths are not printed here on purpose: they differ between TallyPrime
          releases, and a path that is nearly right wastes more time than none. Each
          report is named as Tally names it.
        </p>
      </WideSection>

      <Section title="Three export settings that decide whether this works">
        <ul className="flex flex-col gap-4">
          {SETTINGS.map((s) => (
            <li key={s.title}>
              <h3 className="text-[1rem] font-semibold text-neutral-900">{s.title}</h3>
              <p className="mt-1.5 leading-relaxed text-neutral-600">{s.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Doing it by hand">
        <p>
          The usual method is a workbook per client: paste the trial balance into a sheet,
          map each ledger to a report head with lookups, and let the statements calculate.
          It works, and for one company it is entirely reasonable.
        </p>
        <p>
          It degrades in two predictable ways. Ledger names drift, so a lookup silently
          returns nothing and a head quietly understates. And the mapping lives in one
          person&rsquo;s workbook, so when they are away the month is late. Both are
          failures of the mapping being an artefact rather than a record.
        </p>
      </Section>

      <WideSection
        title={`Doing it with ${PRODUCT_NAME}`}
        intro="The same four steps, with the mapping kept as a record rather than a spreadsheet."
      >
        <div className="mx-auto max-w-[760px]">
          <Steps steps={STEPS} />
          <FictionalNote>
            No sample on this page is computed from anyone&rsquo;s accounts. Before a paid
            action, the product itself shows only file names, sizes, sheet counts and row
            counts.
          </FictionalNote>
        </div>
      </WideSection>

      <MidCta />

      <Section title="Questions">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext paths={["/mis-report-format", "/for-accountants", "/security"]} />
      <ClosingCta />
    </PublicShell>
  );
}
