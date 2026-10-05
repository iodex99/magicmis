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

const PATH = "/guides/mis-report-from-zoho-books";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "MIS report in Zoho Books", "Zoho Books trial balance", "Zoho Books balance sheet report",
 * "Zoho Books profit and loss report", "Zoho Books export to Excel" — Google autocomplete
 * completions under the India setting on 2026-10-05; Bing (en-IN) adds "how to get trial
 * balance in Zoho Books".
 *
 * Every menu path, report name and option below was read on Zoho Books' own India help and
 * knowledge base on 2026-10-05 (SPEC §0.4), and no others are printed:
 * - https://www.zoho.com/in/books/kb/reports/can-i-view-the-trial-balance-report-with-opening-and-closing-balances.html
 *   (Reports > Accountant > Trial Balance; Date Range; Customize Report Columns; Opening and
 *   Closing Balance)
 * - https://www.zoho.com/in/books/kb/reports/compare-periods.html (Compare With, Previous
 *   Period(s))
 * - https://www.zoho.com/in/books/help/reports/business-overview.html (Profit and Loss, Balance
 *   Sheet; Customise; Date Range, Report Basis accrual or cash)
 * - https://www.zoho.com/in/books/help/reports/receivables.html (Aging Summary, Aging Details;
 *   default intervals; Aging By; Aging Intervals; Export As)
 * - https://www.zoho.com/in/books/kb/reports/outstanding-payable-amount-vendor-wise.html
 *   (Payables > AP Aging Summary)
 * - https://www.zoho.com/in/books/kb/reports/difference-between-the-ap-reports.html
 *   (AP Aging Details lists unpaid bills)
 * - https://www.zoho.com/in/books/kb/reports/detailed-general-ledger.html (Accountant > General
 *   Ledger; Export drop-down)
 * - https://www.zoho.com/in/books/help/reports/manage-reports.html (export as PDF)
 * The help names the export menu and says a file format is chosen, but the pages read do not
 * list the formats for every report, so this page names none beyond PDF.
 *
 * Nothing here claims a connection to Zoho Books. There is none: the product works from exports.
 * The mapping table is invented (SPEC §2.3).
 */

const EXPORTS: readonly {
  report: string;
  why: string;
  required: boolean;
}[] = [
  {
    report: "Trial Balance",
    why: "Every account's balance. Everything in the MIS is built from it, so take one for each month you want to report.",
    required: true,
  },
  {
    report: "Profit and Loss",
    why: "Operating income, cost of goods sold, operating expenses and non-operating items for the period. Useful to check the MIS income statement back against the books.",
    required: false,
  },
  {
    report: "Balance Sheet",
    why: "Assets, liabilities and equity at the month end, for the same check on the balance sheet side.",
    required: false,
  },
  {
    report: "Aging Details and AP Aging Details",
    why: "Each open invoice owed to you, and each unpaid bill you owe. This is what the debtors and creditors ageing is built from. The summary versions give one line per customer or vendor.",
    required: false,
  },
  {
    report: "Sales by Customer and Invoice Details",
    why: "Sales by customer and invoice, where the MIS needs revenue in more detail than the accounts give.",
    required: false,
  },
];

const SETTINGS: readonly { title: string; body: string }[] = [
  {
    title: "Export a spreadsheet, not a PDF",
    body: "A PDF holds every figure as text on a page, so each one would have to be re-keyed, and the errors that brings are invisible until someone reconciles. When the export menu asks for the file format, take the spreadsheet.",
  },
  {
    title: "The same basis and filters every month",
    body: "Report Basis switches the profit and loss and the balance sheet between accrual and cash, and Filter Accounts and the advanced filters narrow what is shown. All of them change the figures. Choose once, for the company as a whole, and keep it.",
  },
  {
    title: "One month per file, not a comparison sheet",
    body: "Compare With puts several periods side by side in one sheet, which is useful to read and harder to read back. Run the trial balance for one month at a time and export each; twelve months, twelve files.",
  },
];

const MAPPING: readonly [string, string, string, string][] = [
  ["Consulting Income", "Income", "(146.30)", "Revenue from operations"],
  ["Subcontractor Charges", "Expense", "38.75", "Direct costs"],
  ["Salaries and Wages", "Expense", "71.20", "Employee cost"],
  ["Office Rent", "Expense", "8.40", "Other expenses"],
  ["Bank Charges and Interest", "Expense", "0.65", "Finance costs"],
  ["Accounts Receivable", "Asset", "22.10", "Trade receivables"],
];

const STEPS = [
  {
    icon: "upload" as const,
    title: "Upload the Zoho Books exports",
    body: "The monthly trial balances, and the aging details for receivables and payables if you want ageing. Before you pay for anything, the screen shows only file names, sizes, sheet counts and row counts.",
  },
  {
    icon: "sliders" as const,
    title: "Every account is mapped to a report head, once",
    body: "Each Zoho Books account is placed under a head of your MIS: revenue, direct costs, employee cost, finance costs, trade receivables and so on. Rules settle most of them; AI suggests the rest, and anything it cannot place is shown as unmapped rather than guessed. The mapping is kept.",
  },
  {
    icon: "check-circle" as const,
    title: "Take a checked workbook, a dashboard and commentary",
    body: "An Excel workbook with the P&L and year to date, a balance sheet summary, key ratios, debtors and creditors ageing, and a payroll summary when payroll data is loaded, in lakhs and crores on an April to March year by default. Beside it, a dashboard you build by chatting and a written commentary on the month. Every figure opens onto the accounts it came from.",
  },
  {
    icon: "refresh" as const,
    title: "Next month is a refresh",
    body: "Export the new month's trial balance from Zoho Books and upload it. The mapping is reused, and if no account has been added the refresh makes no AI call at all. A new account is flagged for you to place.",
  },
];

const FAQS: readonly Faq[] = [
  {
    question: "Can Zoho Books produce an MIS report by itself?",
    answer:
      "Zoho Books produces the reports an MIS is made from, and its reports can be customised, compared with earlier periods and scheduled to arrive by email. What it does not produce is one management report in the business's own heads, with the month beside the year to date and last year, ratios worked the same way every month, ageing and a written explanation of the month. That part is usually finished by hand in Excel.",
  },
  {
    question: "Which Zoho Books report do I have to export for an MIS?",
    answer:
      "The Trial Balance, one for each month. It holds every account's balance, so a P&L, a balance sheet and the ratios can all be built from it. The Profit and Loss and Balance Sheet are useful as a check, the aging details add the ageing, and Sales by Customer adds revenue by customer.",
  },
  {
    question: "How do I get the trial balance for one month in Zoho Books?",
    answer:
      "Open Reports, then Trial Balance under Accountant. Next to Filters, change As of Date to Date Range, choose Custom and set the first and last day of the month, then Run Report. Customize Report Columns lets you add Opening Balance and Closing Balance beside the month's debits and credits; keep the closing balance in the file you export.",
  },
  {
    question: `Does ${PRODUCT_NAME} connect to Zoho Books?`,
    answer:
      "No. There is no integration, no live sync and no access to grant. You export the reports you would export anyway and upload the files; nothing holds standing access to your books. The trade-off is plain: each month starts with an export. If a daily sync matters more to you than that, a tool that connects to Zoho Books is the better fit.",
  },
  {
    question: "Is it safe to upload Zoho Books exports?",
    answer:
      "Each file is encrypted under a key unique to that company and kept until you delete it. No member of staff can open a file, every opening is on a record you can see, and deleting the company destroys its key. The AI receives redacted account names and capped, redacted samples, never a whole file and never your customers' or employees' names.",
  },
];

export default function MisReportFromZohoBooksGuide() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Guide"
        heading="MIS report from Zoho Books: which reports to export, and what to do next"
        intro="Zoho Books holds every figure a monthly MIS needs, and its reports can be customised and scheduled. What it does not do is turn them into one management report in your own heads, with comparatives, ratios, ageing and commentary. This is which reports to take each month, where they are, and what to do with them."
      />

      <WideSection
        title="Five Zoho Books reports make a monthly MIS, and only the trial balance is essential"
        intro="Every one of them is under Reports in the left sidebar. Each of the others adds a section to the report or a check on it, rather than being needed to produce one."
      >
        <div className="mx-auto max-w-[860px] overflow-x-auto rounded-xl border border-neutral-200/80 bg-surface">
          <table className="w-full min-w-[520px] border-collapse text-[0.9375rem]">
            <thead>
              <tr className="border-b border-neutral-200/80 text-[0.8125rem] text-neutral-500">
                <th scope="col" className="px-5 py-3 text-left font-medium">
                  Zoho Books report
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
          Report names are as Zoho Books&rsquo; India help gives them. Zoho renames and
          moves reports from time to time, so where your screen disagrees, trust the
          screen.
        </p>
      </WideSection>

      <Section title="Zoho Books groups the reports by category: Accountant, Business Overview, Receivables and Payables">
        <p>
          <strong className="font-medium text-neutral-900">Trial balance.</strong>{" "}
          <strong className="font-medium text-neutral-900">
            Reports &gt; Accountant &gt; Trial Balance
          </strong>
          . Next to Filters, change As of Date to Date Range, choose Custom and set the
          first and last day of the month; Customize Report Columns then adds Opening
          Balance and Closing Balance beside the month&rsquo;s debits and credits. Keep
          the Closing Balance column in the export. The General Ledger is in the same
          Accountant category if you need every transaction behind a balance.
        </p>
        <p>
          <strong className="font-medium text-neutral-900">
            Profit and loss and balance sheet.
          </strong>{" "}
          Both are under{" "}
          <strong className="font-medium text-neutral-900">Business Overview</strong>. The
          Customise icon at the top right sets the Date Range and the Report Basis,
          accrual or cash.
        </p>
        <p>
          <strong className="font-medium text-neutral-900">Ageing.</strong> Under{" "}
          <strong className="font-medium text-neutral-900">Receivables</strong> are Aging
          Summary and Aging Details, and under{" "}
          <strong className="font-medium text-neutral-900">Payables</strong> is AP Aging
          Summary, with AP Aging Details listing every unpaid bill. By default receivables
          age into Current, 1&ndash;15, 16&ndash;30, 31&ndash;45 and over 45 days; Aging
          By and Aging Intervals change the basis and the buckets.
        </p>
      </Section>

      <Section title="Zoho Books to Excel: Export at the top right of the report, then the file format">
        <p>
          With the report run, click{" "}
          <strong className="font-medium text-neutral-900">Export</strong> at the top
          right of the page (some reports call it{" "}
          <strong className="font-medium text-neutral-900">Export As</strong>) and choose
          the file format. A large report such as a detailed general ledger is prepared in
          the background, and Zoho Books tells you when it is ready to download.
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

      <Section title="A monthly MIS from Zoho Books is still rebuilt by hand, and the rebuild is where the days go">
        <p>
          A monthly MIS holds a P&amp;L for the month and the year to date beside last
          year, a balance sheet, the key ratios, debtors and creditors ageing, and a
          written note on what changed. Producing it from Zoho Books by hand means pasting
          each trial balance into a workbook, mapping every account to a report head with
          lookups, fixing the signs, rolling the comparatives forward and writing the
          commentary from scratch.
        </p>
        <p>
          The mapping is the fragile part. An account added mid-year falls through the
          lookup, a head quietly understates, and nobody notices until the totals fail to
          tie. The commentary is the slow part: it is written last, by whoever has the
          least time left.
        </p>
      </Section>

      <WideSection
        title="Mapping Zoho Books accounts to MIS heads is the step that has to be right"
        intro="A few rows from the mapping of a fictional consulting firm. Balances in lakhs of rupees for the year to date; credits in brackets, as a trial balance holds them."
      >
        <div className="mx-auto max-w-[900px]">
          <div className="overflow-x-auto rounded-xl border border-neutral-200/80 bg-surface">
            <table className="w-full min-w-[620px] border-collapse text-[0.9375rem]">
              <thead>
                <tr className="border-b border-neutral-200/80 text-[0.8125rem] text-neutral-500">
                  <th scope="col" className="px-5 py-2.5 text-left font-medium">
                    Zoho Books account
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
        title={`${PRODUCT_NAME} turns the Zoho Books exports into a checked MIS, and month two is a refresh`}
        intro="It works from the files you export. It does not connect to Zoho Books."
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

      <Section title="What people ask about an MIS from Zoho Books">
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
        heading="Upload last month's Zoho Books trial balance and see the MIS"
        body={`${PRODUCT_NAME} maps every Zoho Books account to a report head once, builds a checked workbook, a dashboard and commentary, and keeps the mapping so next month is a refresh.`}
      />
    </PublicShell>
  );
}
