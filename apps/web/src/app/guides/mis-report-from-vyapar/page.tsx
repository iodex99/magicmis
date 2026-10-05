import type { Metadata } from "next";

import {
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

const PATH = "/guides/mis-report-from-vyapar";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "Vyapar balance sheet", "Vyapar app balance sheet", "Vyapar reports", "Vyapar app aging
 * report", "Vyapar PDF to Excel", "Vyapar app me ledger kaise nikale", "Vyapar profit" — Google
 * autocomplete completions under the India setting on 2026-10-05.
 *
 * Every menu path, report name and export option below was read on Vyapar's own site on
 * 2026-10-05 (SPEC §0.4), and no others are printed:
 * - https://vyaparapp.in/guides/how-to-check-transaction-reports-in-vyapar-app (Reports >
 *   Transaction Reports: Sale, Purchase, Day book, All Transactions, Profit and Loss, Bill Wise
 *   Profit, Sale Aging, Cash flow, Trial Balance Report, Balance Sheet; xls and Print icons;
 *   Trial Balance "Show working trial balance" and "Show 0 balances account")
 * - https://vyaparapp.in/videos/how-to-get-trial-balance-report (Reports > Transaction Reports >
 *   Trial Balance Report; date filters; PDF or Excel)
 * - https://vyaparapp.in/guides/how-to-check-your-balance-sheet-in-vyapar (desktop; Excel and
 *   PDF icons)
 * - https://vyaparapp.in/guides/how-to-check-profit-and-loss-report-in-vyapar (Excel Report
 *   icon)
 * - https://vyaparapp.in/videos/how-to-manage-accounts-receivable-and-payable (Reports > Party
 *   Reports > All Parties; receivables or payables filter; export to Excel)
 * The paths are for the desktop software, which the guides describe.
 *
 * Nothing here claims a connection to Vyapar. There is none: the product works from exports.
 * The mapping table is invented (SPEC §2.3).
 */

const EXPORTS: readonly {
  report: string;
  why: string;
  required: boolean;
}[] = [
  {
    report: "Trial Balance Report",
    why: "The closing balance of every account. Everything in the MIS is built from it, so take one for each month you want to report.",
    required: true,
  },
  {
    report: "Profit and Loss",
    why: "Sales, purchases, direct and indirect expenses, and opening and closing stock for the period. Useful to check the MIS income statement back against the books.",
    required: false,
  },
  {
    report: "Balance Sheet",
    why: "What the business owns and owes at the month end, for the same check on the balance sheet side.",
    required: false,
  },
  {
    report: "Sale Aging and All Parties",
    why: "What each customer owes and for how many days, and every party's receivable or payable balance. These give the debtors and creditors sections.",
    required: false,
  },
  {
    report: "Sale Report and Purchase Report",
    why: "Invoice-level sales and purchases, where the MIS needs revenue by customer or by month in more detail than the accounts give.",
    required: false,
  },
];

const SETTINGS: readonly { title: string; body: string }[] = [
  {
    title: "An Excel file, never a PDF",
    body: "The trial balance, profit and loss, balance sheet, party balances and the sale and purchase reports each have an Excel icon as well as Print. A PDF holds every figure as text on a page, so each one would have to be re-keyed, and the errors that brings are invisible until someone reconciles. If a PDF is all you have from an earlier month, keep it: a PDF with real text in it can still be read, but Excel is the better file.",
  },
  {
    title: "The same view and filters every month",
    body: "The profit and loss can be shown in a Vyapar view or an Accounting view, and some reports filter by firm or by godown. Each choice changes what is in the file. Pick the view and filters once, for the business as a whole, and keep them.",
  },
  {
    title: "One file per month, not the year in one",
    body: "Set a custom period of one month, export it, and repeat. A single export covering the year cannot be split back into months reliably; twelve months, twelve files, and the comparatives build themselves.",
  },
];

const MAPPING: readonly [string, string, string, string][] = [
  ["Sale", "Income", "(58.40)", "Revenue from operations"],
  ["Purchase", "Expense", "44.15", "Purchases of stock-in-trade"],
  ["Staff Salary", "Expense", "3.60", "Employee cost"],
  ["Shop Rent", "Expense", "1.80", "Other expenses"],
  ["Business Loan Interest", "Expense", "0.55", "Finance costs"],
  ["Gupta General Store", "Asset", "1.25", "Trade receivables"],
];

const STEPS = [
  {
    icon: "upload" as const,
    title: "Upload the Vyapar exports",
    body: "The monthly trial balances, and the ageing and party balances if you want them. Before you pay for anything, the screen shows only file names, sizes, sheet counts and row counts.",
  },
  {
    icon: "sliders" as const,
    title: "Every account is mapped to a report head, once",
    body: "Each account in the Vyapar trial balance is placed under a head of your MIS: revenue, purchases, employee cost, finance costs, trade receivables and so on. Rules settle most of them; AI suggests the rest, and anything it cannot place is shown as unmapped rather than guessed. The mapping is kept.",
  },
  {
    icon: "check-circle" as const,
    title: "Take a checked workbook, a dashboard and commentary",
    body: "An Excel workbook with the P&L and year to date, a balance sheet summary, key ratios, debtors and creditors ageing, and a payroll summary when payroll data is loaded, in lakhs and crores on an April to March year by default. Beside it, a dashboard you build by chatting and a written commentary on the month. Every figure opens onto the accounts it came from.",
  },
  {
    icon: "refresh" as const,
    title: "Next month is a refresh",
    body: "Export the new month's trial balance from Vyapar and upload it. The mapping is reused, and if no account has been added the refresh makes no AI call at all. A new account is flagged for you to place.",
  },
];

const FAQS: readonly Faq[] = [
  {
    question: "Can Vyapar make an MIS report?",
    answer:
      "Vyapar produces the reports an MIS is made from: the trial balance, profit and loss, balance sheet, sale ageing and party balances, each exportable to Excel. What it does not produce is one management report with the month beside the year to date and last year, ratios worked the same way every month, ageing and a written explanation of the month. That part is usually assembled by hand in Excel.",
  },
  {
    question: "Where is the trial balance in Vyapar?",
    answer:
      "In the desktop software, open Reports from the left menu and, under Transaction Reports, click Trial Balance Report. Set the period with the date filter, then click the Excel icon to export it.",
  },
  {
    question: "Which Vyapar report do I have to export for an MIS?",
    answer:
      "The Trial Balance Report, one for each month. It holds every account's balance, so a P&L, a balance sheet and the ratios can all be built from it. The Profit and Loss and Balance Sheet are useful as a check, Sale Aging and All Parties add the debtors and creditors, and the sale and purchase reports add invoice-level detail.",
  },
  {
    question: `Does ${PRODUCT_NAME} connect to Vyapar?`,
    answer:
      "No. There is no connector and nothing to install beside Vyapar. You export the reports you would export anyway and upload the files; nothing holds standing access to your books.",
  },
  {
    question: "Is it safe to upload Vyapar exports?",
    answer:
      "Each file is encrypted under a key unique to that company and kept until you delete it. No member of staff can open a file, every opening is on a record you can see, and deleting the company destroys its key. The AI receives redacted account names and capped, redacted samples, never a whole file and never your parties' names.",
  },
];

export default function MisReportFromVyaparGuide() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Guide"
        heading="MIS report from Vyapar: which reports to export, and what to do next"
        intro="Vyapar keeps the books behind every bill it prints, and its reports hold every figure a monthly MIS needs. What it does not do is turn them into one management report with comparatives, ratios, ageing and commentary. This is which reports to take each month, where they are, and what to do with them."
      />

      <WideSection
        title="Five Vyapar reports make a monthly MIS, and only the trial balance is essential"
        intro="All of them are under Reports in the left menu of the desktop software. Each of the others adds a section to the report or a check on it, rather than being needed to produce one."
      >
        <div className="mx-auto max-w-[860px] overflow-x-auto rounded-xl border border-neutral-200/80 bg-surface">
          <table className="w-full min-w-[520px] border-collapse text-[0.9375rem]">
            <thead>
              <tr className="border-b border-neutral-200/80 text-[0.8125rem] text-neutral-500">
                <th scope="col" className="px-5 py-3 text-left font-medium">
                  Vyapar report
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
          Report names and menu paths are as Vyapar&rsquo;s own guides give them for the
          desktop software. The mobile app and later releases can differ, so where your
          screen disagrees, trust the screen.
        </p>
      </WideSection>

      <Section title="Vyapar keeps the statements under Transaction Reports and the balances under Party Reports">
        <p>
          <strong className="font-medium text-neutral-900">
            Trial balance, profit and loss, balance sheet and sale ageing.
          </strong>{" "}
          Open <strong className="font-medium text-neutral-900">Reports</strong> from the
          left menu; under{" "}
          <strong className="font-medium text-neutral-900">Transaction Reports</strong>{" "}
          are Trial Balance Report, Profit and Loss, Balance Sheet and Sale Aging, beside
          the Sale and Purchase reports and the Day book. The trial balance takes a custom
          period, with tick boxes to show a working trial balance and accounts with a zero
          balance. Sale Aging lists each party&rsquo;s pending amount and how many days it
          has been overdue.
        </p>
        <p>
          <strong className="font-medium text-neutral-900">Party balances.</strong>{" "}
          <strong className="font-medium text-neutral-900">
            Reports &gt; Party Reports &gt; All Parties
          </strong>{" "}
          shows what every customer owes you and what you owe every supplier; the filter
          at the top narrows it to receivables or payables only.
        </p>
      </Section>

      <Section title="Vyapar to Excel: click the Excel icon on the report, not Print">
        <p>
          With the report open and the period set, click the{" "}
          <strong className="font-medium text-neutral-900">Excel</strong> icon (shown as
          xls on some screens) to download it as an Excel file. The Print icon beside it
          is for a PDF or a paper copy.
        </p>
        <ul className="flex flex-col gap-4">
          {SETTINGS.map((s) => (
            <li key={s.title}>
              <h3 className="text-[1rem] font-semibold text-neutral-900">{s.title}</h3>
              <p className="mt-1.5 leading-relaxed text-neutral-600">{s.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="A monthly MIS from Vyapar is rebuilt by hand, and the rebuild is where the days go">
        <p>
          A monthly MIS holds a P&amp;L for the month and the year to date beside last
          year, a balance sheet, the key ratios, debtors and creditors ageing, and a
          written note on what changed. For a shop or a small trader on Vyapar, or the
          accountant who looks after one, producing it by hand means pasting each trial
          balance into a workbook, mapping every account to a report head with lookups,
          fixing the signs, rolling the comparatives forward and writing the commentary
          from scratch.
        </p>
        <p>
          The mapping is the fragile part. An expense account added mid-year falls through
          the lookup, a head quietly understates, and nobody notices until the totals fail
          to tie. The commentary is the slow part: it is written last, by whoever has the
          least time left.
        </p>
      </Section>

      <WideSection
        title="Mapping Vyapar accounts to MIS heads is the step that has to be right"
        intro="A few rows from the mapping of a fictional wholesale shop. Balances in lakhs of rupees for the year to date; credits in brackets, as a trial balance holds them."
      >
        <div className="mx-auto max-w-[900px]">
          <div className="overflow-x-auto rounded-xl border border-neutral-200/80 bg-surface">
            <table className="w-full min-w-[620px] border-collapse text-[0.9375rem]">
              <thead>
                <tr className="border-b border-neutral-200/80 text-[0.8125rem] text-neutral-500">
                  <th scope="col" className="px-5 py-2.5 text-left font-medium">
                    Vyapar account
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-left font-medium">
                    Nature
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-right font-medium">
                    Year to date
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-left font-medium">
                    MIS head
                  </th>
                </tr>
              </thead>
              <tbody>
                {MAPPING.map(([account, nature, balance, head]) => (
                  <tr key={account} className="border-b border-neutral-100 last:border-0">
                    <th
                      scope="row"
                      className="px-5 py-2.5 text-left font-normal text-neutral-800"
                    >
                      {account}
                    </th>
                    <td className="px-5 py-2.5 text-neutral-600">{nature}</td>
                    <td className="px-5 py-2.5 text-right text-neutral-900 tabular-nums">
                      {balance}
                    </td>
                    <td className="px-5 py-2.5 text-neutral-800">{head}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <FictionalNote>
            Invented accounts and balances, for illustration only. Nothing here comes from
            anyone&rsquo;s books.
          </FictionalNote>
        </div>
      </WideSection>

      <WideSection
        title={`${PRODUCT_NAME} turns the Vyapar exports into a checked MIS, and month two is a refresh`}
        intro="It works from the files you export. It does not connect to Vyapar."
      >
        <div className="mx-auto max-w-[760px]">
          <Steps steps={STEPS} />
          <p className="mt-6 text-[0.9375rem] leading-relaxed text-neutral-600">
            The AI maps accounts and writes the words. It is not allowed to write a
            figure: every number in the workbook, the dashboard and the commentary is
            computed by the engine from your trial balance, and a draft that contains a
            number of its own is rejected.
          </p>
        </div>
      </WideSection>

      <MidCta />

      <Section title="What people ask about an MIS from Vyapar">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext
        paths={[
          "/mis-report-format",
          "/guides/trial-balance-to-management-report",
          "/guides/debtors-ageing-report",
          "/how-to-make-an-mis-report-in-excel",
        ]}
      />
      <ClosingCta
        heading="Upload last month's Vyapar trial balance and see the MIS"
        body={`${PRODUCT_NAME} maps every Vyapar account to a report head once, builds a checked workbook, a dashboard and commentary, and keeps the mapping so next month is a refresh.`}
      />
    </PublicShell>
  );
}
